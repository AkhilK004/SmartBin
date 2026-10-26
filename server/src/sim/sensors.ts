// Sensor simulator. It owns the physical truth of every bin (fill, gas, temperature, battery,
// connectivity) and reports it as SensorReadings, exactly what an ESP32 would send.
// ASSUMPTION (CLAUDE.md §10): fill rates, spikes, battery drain and outages are invented.

import { config } from "../config.js";
import { mulberry32 } from "../seed.js";
import type { BinBase, SensorReading } from "../types.js";

const sim = config.sim;
const H = 3600_000;

interface Truth {
  bin_id: string;
  lat: number;
  lng: number;
  fill: number;
  /** What the same bin would hold if the fixed baseline schedule served it (Savings, overflows missed). */
  shadowFill: number;
  rate: number;
  battery: number;
  drainPerDay: number;
  gasBase: number;
  tempBase: number;
  gasSpikeUntil: number;
  gasSpikeAdd: number;
  tempSpikeUntil: number;
  tempSpikeAdd: number;
  offlineUntil: number; // 0 = online; Infinity = held offline by hand
  nextReadingAt: number;
  overflowed: boolean;
  shadowOverflowed: boolean;
}

export interface OverflowEvent {
  bin_id: string;
  /** true = the fixed-baseline replay overflowed, false = the real (optimized) schedule did. */
  baseline: boolean;
  at: Date;
}

export interface BinOverride {
  fill_pct?: number;
  gas_ppm?: number;
  temp_c?: number;
  offline?: boolean;
}

export class SensorSim {
  private truth = new Map<string, Truth>();
  private rand: () => number;
  /** Latest reading per bin since the last flush. */
  private buffer = new Map<string, SensorReading>();

  constructor(bins: BinBase[], now: Date) {
    this.rand = mulberry32(config.sim.seed);
    for (const b of bins) {
      this.truth.set(b.bin_id, {
        bin_id: b.bin_id,
        lat: b.lat,
        lng: b.lng,
        fill: b.fill_pct,
        shadowFill: b.fill_pct,
        rate: b.fill_rate_pct_per_hour,
        battery: b.battery,
        drainPerDay: this.between(sim.batteryDrainPctPerDay),
        gasBase: b.gas_ppm,
        tempBase: b.temp_c,
        gasSpikeUntil: 0,
        gasSpikeAdd: 0,
        tempSpikeUntil: 0,
        tempSpikeAdd: 0,
        offlineUntil: 0,
        nextReadingAt: now.getTime() + this.rand() * sim.readingJitterS * 1000,
        overflowed: b.fill_pct >= config.thresholds.overflowPct,
        shadowOverflowed: b.fill_pct >= config.thresholds.overflowPct,
      });
    }
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rand() * (hi - lo);
  }

  /** Advance the physical world by dt seconds ending at `now`. Returns overflow events. */
  step(dtS: number, now: Date): OverflowEvent[] {
    const events: OverflowEvent[] = [];
    const t = now.getTime();
    const dtH = dtS / 3600;
    for (const b of this.truth.values()) {
      // identical growth for the real bin and its baseline shadow
      const grow = b.rate * dtH * (1 + (this.rand() * 2 - 1) * sim.fillNoise);
      b.fill = Math.min(100, b.fill + grow);
      b.shadowFill = Math.min(100, b.shadowFill + grow);
      if (b.fill >= config.thresholds.overflowPct && !b.overflowed) {
        b.overflowed = true;
        events.push({ bin_id: b.bin_id, baseline: false, at: now });
      }
      if (b.shadowFill >= config.thresholds.overflowPct && !b.shadowOverflowed) {
        b.shadowOverflowed = true;
        events.push({ bin_id: b.bin_id, baseline: true, at: now });
      }

      b.battery = Math.max(0, b.battery - (b.drainPerDay * dtS) / 86400);

      if (b.gasSpikeUntil <= t) b.gasSpikeAdd = 0;
      if (b.gasSpikeAdd === 0 && this.rand() < sim.gasSpikePerBinPerHour * dtH) {
        b.gasSpikeAdd = this.between(sim.gasSpikeAddPpm);
        b.gasSpikeUntil = t + this.between(sim.spikeDurationH) * H;
      }
      if (b.tempSpikeUntil <= t) b.tempSpikeAdd = 0;
      if (b.tempSpikeAdd === 0 && this.rand() < sim.tempSpikePerBinPerHour * dtH) {
        b.tempSpikeAdd = this.between(sim.tempSpikeAddC);
        b.tempSpikeUntil = t + this.between(sim.spikeDurationH) * H;
      }

      if (b.offlineUntil === 0 && this.rand() < sim.offlinePerBinPerHour * dtH) {
        b.offlineUntil = t + this.between(sim.offlineDurationH) * H;
      } else if (b.offlineUntil !== 0 && b.offlineUntil !== Infinity && b.offlineUntil <= t) {
        b.offlineUntil = 0;
      }

      if (t >= b.nextReadingAt) {
        b.nextReadingAt = t + config.alerts.readingIntervalS * 1000;
        this.report(b, now);
      }
    }
    return events;
  }

  private report(b: Truth, now: Date): void {
    if (b.offlineUntil !== 0) return; // a silent sensor sends nothing
    const noise = (n: number) => (this.rand() * 2 - 1) * n;
    this.buffer.set(b.bin_id, {
      bin_id: b.bin_id,
      fill_pct: Math.round(b.fill * 10) / 10,
      lat: b.lat,
      lng: b.lng,
      battery: Math.round(b.battery * 10) / 10,
      temp_c: Math.round((b.tempBase + b.tempSpikeAdd + noise(sim.tempNoiseC)) * 10) / 10,
      gas_ppm: Math.max(0, Math.round(b.gasBase + b.gasSpikeAdd + noise(sim.gasNoisePpm))),
      timestamp: now.toISOString(),
    });
  }

  /** Readings produced since the last call (latest per bin). */
  drain(): SensorReading[] {
    const out = [...this.buffer.values()];
    this.buffer.clear();
    return out;
  }

  /** A truck emptied the bin. The sensor reports 0 right away. */
  empty(binId: string, now: Date): void {
    const b = this.truth.get(binId);
    if (!b) return;
    b.fill = 0;
    b.overflowed = false;
    this.report(b, now);
  }

  /** The fixed baseline schedule served these bins (replay only). */
  emptyShadow(binIds: string[]): void {
    for (const id of binIds) {
      const b = this.truth.get(id);
      if (!b) continue;
      b.shadowFill = 0;
      b.shadowOverflowed = false;
    }
  }

  /** Manual simulator control. Returns overflow events caused by the change. */
  override(binId: string, o: BinOverride, now: Date): OverflowEvent[] {
    const b = this.truth.get(binId);
    if (!b) throw new Error(`unknown bin ${binId}`);
    const events: OverflowEvent[] = [];
    if (o.fill_pct !== undefined) {
      b.fill = b.shadowFill = o.fill_pct;
      const over = o.fill_pct >= config.thresholds.overflowPct;
      if (over && !b.overflowed) events.push({ bin_id: binId, baseline: false, at: now });
      if (over && !b.shadowOverflowed) events.push({ bin_id: binId, baseline: true, at: now });
      b.overflowed = b.shadowOverflowed = over;
    }
    if (o.gas_ppm !== undefined) {
      b.gasBase = o.gas_ppm;
      b.gasSpikeAdd = 0;
      b.gasSpikeUntil = 0;
    }
    if (o.temp_c !== undefined) {
      b.tempBase = o.temp_c;
      b.tempSpikeAdd = 0;
      b.tempSpikeUntil = 0;
    }
    if (o.offline !== undefined) b.offlineUntil = o.offline ? Infinity : 0;
    if (!b.offlineUntil) this.report(b, now);
    return events;
  }

  /** Physical fill of a bin, for tests and diagnostics. */
  fillOf(binId: string): number | undefined {
    return this.truth.get(binId)?.fill;
  }
}
