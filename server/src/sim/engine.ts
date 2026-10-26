// Simulation engine: one simulated clock drives the sensors, the trucks, the fixed-baseline
// replay and the job scheduler. Time advances in sub-steps of at most config.sim.maxStepS so
// that 600x does not skip over stops.

import type { HistoryStore, StateStore } from "../adapters/types.js";
import { config } from "../config.js";
import { rollCalendars, scheduleFor } from "../domain/frequency.js";
import type { Pipeline } from "../pipeline.js";
import { addDays, localDate, localInstant } from "../time.js";
import type { Bin, ZoneId } from "../types.js";
import { SimClock } from "./clock.js";
import { SensorSim, type BinOverride, type OverflowEvent } from "./sensors.js";
import { TruckSim } from "./trucks.js";

export interface SimStatus {
  speed: number;
  now: string;
  overflows_missed: {
    by_date: Record<string, { baseline: number; optimized: number }>;
    total: { baseline: number; optimized: number };
  };
}

export interface SimControl {
  setSpeed(speed: number): boolean;
  setBin(binId: string, patch: BinOverride & { complaint?: boolean }): Bin | undefined;
  status(): SimStatus;
}

export interface SimEngineDeps {
  store: StateStore;
  history: HistoryStore;
  pipeline: Pipeline;
  clock: SimClock;
  /** Shared with the app context so `state:init` reports the live speed. */
  sim: { speed: number };
  /** Delivers readings the way a device would (POST /ingest/readings). */
  publish(readings: import("../types.js").SensorReading[]): Promise<void>;
  /** Fires a scheduled job (POST /jobs/*), like Cloud Scheduler / EventBridge. */
  callJob(path: string): Promise<void>;
}

const SCHEDULE = [
  { path: "/jobs/frequency", hour: 0, minute: 0 },
  { path: "/jobs/daily", hour: 0, minute: 30 },
] as const;

export class SimEngine implements SimControl {
  readonly sensors: SensorSim;
  readonly trucks: TruckSim;
  private overflows = new Map<string, { baseline: number; optimized: number }>();
  private lastBaseline = new Map<ZoneId, string>();
  private jobRunning = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private d: SimEngineDeps) {
    const now = d.clock.now();
    this.sensors = new SensorSim(d.store.getBins(), now);
    const depot = d.store.getSites().find((s) => s.kind === "depot");
    if (!depot) throw new Error("depot must be configured");
    this.trucks = new TruckSim(d.store.getTrucks(), depot, {
      onCollect: (binId, at) => this.collect(binId, at),
      onZonesCollected: (zones, date) => this.zonesCollected(zones, date),
    });
    d.store.setTrucks(this.trucks.snapshot()); // runs are not persisted: every truck starts idle
    for (const z of d.store.getZones()) this.lastBaseline.set(z.zone_id, z.last_collection_date);
    d.pipeline.events.on("plan:new", (plan) => this.trucks.loadPlan(plan, d.clock.now()));
  }

  // ---- control surface ----

  setSpeed(speed: number): boolean {
    if (!(config.simSpeeds as readonly number[]).includes(speed)) return false;
    this.d.sim.speed = speed;
    return true;
  }

  setBin(binId: string, patch: BinOverride & { complaint?: boolean }): Bin | undefined {
    const bin = this.d.store.getBin(binId);
    if (!bin) return undefined;
    const now = this.d.clock.now();
    const { complaint, ...sensor } = patch;
    this.tally(this.sensors.override(binId, sensor, now));
    const bits: Partial<typeof bin> = {};
    // show the change at once; the sensor's next reading confirms it
    if (sensor.fill_pct !== undefined) bits.fill_pct = sensor.fill_pct;
    if (sensor.gas_ppm !== undefined) bits.gas_ppm = sensor.gas_ppm;
    if (sensor.temp_c !== undefined) bits.temp_c = sensor.temp_c;
    if (complaint !== undefined) bits.complaint = complaint;
    if (patch.offline) bits.status = "offline"; // shown at once, without waiting for missed readings
    const updated = Object.keys(bits).length > 0 ? this.d.pipeline.patchBin(binId, bits) : bin;
    void this.flush();
    return updated ? this.d.pipeline.enrich(updated) : undefined;
  }

  status(): SimStatus {
    const by_date = Object.fromEntries(this.overflows);
    const total = { baseline: 0, optimized: 0 };
    for (const v of this.overflows.values()) {
      total.baseline += v.baseline;
      total.optimized += v.optimized;
    }
    return { speed: this.d.sim.speed, now: this.d.clock.now().toISOString(), overflows_missed: { by_date, total } };
  }

  // ---- time ----

  /** Advance simulated time by `seconds`, then deliver the readings and publish truck positions. */
  async advance(seconds: number): Promise<void> {
    let rem = seconds;
    while (rem > 0) {
      const dt = Math.min(rem, config.sim.maxStepS);
      this.step(dt);
      rem -= dt;
    }
    this.d.pipeline.sweepOffline();
    this.d.store.setTrucks(this.trucks.snapshot());
    await this.flush();
    this.d.pipeline.events.emit("sim:tick", { trucks: this.d.store.getTrucks(), sim: { speed: this.d.sim.speed, now: this.d.clock.now().toISOString() } });
  }

  start(): void {
    this.timer = setInterval(() => {
      if (this.busy) return; // a slow tick must not pile up
      this.busy = true;
      this.advance((this.d.sim.speed * config.sim.tickMs) / 1000)
        .catch((err) => console.error("sim tick failed", err))
        .finally(() => (this.busy = false));
    }, config.sim.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private step(dtS: number): void {
    const prev = this.d.clock.now();
    this.d.clock.advance(dtS);
    const now = this.d.clock.now();
    this.tally(this.sensors.step(dtS, now));
    this.trucks.step(dtS, now);
    for (const date of this.crossings(prev, now, config.collectionStartHour, 0)) this.baselineCollects(date);
    for (const job of SCHEDULE) {
      if (this.crossings(prev, now, job.hour, job.minute).length > 0) this.fireJob(job.path);
    }
  }

  /** Local dates whose hh:mm instant lies in (prev, next]. */
  private crossings(prev: Date, next: Date, hour: number, minute: number): string[] {
    const dates = new Set([localDate(prev), localDate(next), addDays(localDate(prev), 1)]);
    return [...dates].filter((d) => {
      const t = localInstant(d, hour, minute).getTime();
      return t > prev.getTime() && t <= next.getTime();
    });
  }

  private fireJob(path: string): void {
    if (this.jobRunning.has(path)) return;
    this.jobRunning.add(path);
    this.d
      .callJob(path)
      .catch((err) => console.error(`${path} failed`, err))
      .finally(() => this.jobRunning.delete(path));
  }

  // ---- effects ----

  private async flush(): Promise<void> {
    const readings = this.sensors.drain();
    if (readings.length > 0) await this.d.publish(readings);
  }

  private collect(binId: string, at: Date): void {
    this.sensors.empty(binId, at);
    void this.d.history.appendEmptying({ bin_id: binId, at: at.toISOString() });
    this.d.pipeline.patchBin(binId, { last_emptied: at.toISOString() });
  }

  /** The zones' primary run finished: their last collection is that date. */
  private zonesCollected(zones: ZoneId[], date: string): void {
    const today = localDate(this.d.clock.now());
    const updated = this.d.store.getZones().map((z) => (zones.includes(z.zone_id) ? { ...z, last_collection_date: date } : z));
    this.d.store.setZones(rollCalendars(updated, today));
  }

  /** Fixed-baseline replay: on a zone's fixed collection day every bin of the zone is emptied at once. */
  private baselineCollects(date: string): void {
    for (const z of this.d.store.getZones()) {
      const last = this.lastBaseline.get(z.zone_id) ?? z.last_collection_date;
      const due = scheduleFor(z.fill_rate_pct_per_day, last, date).calendar.includes(date);
      if (!due) continue;
      this.lastBaseline.set(z.zone_id, date);
      this.sensors.emptyShadow(this.d.store.getBins().filter((b) => b.zone_id === z.zone_id).map((b) => b.bin_id));
    }
  }

  private tally(events: OverflowEvent[]): void {
    for (const e of events) {
      const key = localDate(e.at);
      const row = this.overflows.get(key) ?? { baseline: 0, optimized: 0 };
      if (e.baseline) row.baseline += 1;
      else row.optimized += 1;
      this.overflows.set(key, row);
    }
  }
}
