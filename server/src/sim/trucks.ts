// Truck simulator. Each truck drives its planned route along the OSRM road geometry at the
// assumed constant speed, dwells at every stop, empties bins, unloads at the dump yard and
// returns to the depot (CLAUDE.md §10: speed 22 km/h, 60 s per bin are assumptions).

import { config } from "../config.js";
import { haversineM } from "../geo.js";
import { collectionStart } from "../time.js";
import type { Plan, PlanRoute, Site, Truck, ZoneId } from "../types.js";

interface Run {
  route: PlanRoute;
  /** Cumulative road metres at the arrival at stop i. */
  stopDist: number[];
  total: number;
  geom: [number, number][];
  geomCum: number[];
  s: number;
  next: number;
  phase: "driving" | "dwell";
  dwellLeft: number;
  startAtMs: number;
  /** The plan this run belongs to, for primary routes (zone completion). */
  tracker: PlanTracker | null;
}

interface PlanTracker {
  date: string;
  zones: ZoneId[];
  remaining: Set<string>;
}

export interface TruckSimDeps {
  /** The bin was emptied at `at`. */
  onCollect(binId: string, at: Date): void;
  /** All primary routes of a plan finished: these zones were collected on `date`. */
  onZonesCollected(zones: ZoneId[], date: string): void;
}

const MPS = (config.truckSpeedKmh * 1000) / 3600;

function cumulative(geom: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < geom.length; i++) {
    cum.push(cum[i - 1]! + haversineM(geom[i - 1]![1], geom[i - 1]![0], geom[i]![1], geom[i]![0]));
  }
  return cum;
}

function bearing(from: [number, number], to: [number, number]): number {
  const rad = Math.PI / 180;
  const y = Math.sin((to[0] - from[0]) * rad) * Math.cos(to[1] * rad);
  const x =
    Math.cos(from[1] * rad) * Math.sin(to[1] * rad) -
    Math.sin(from[1] * rad) * Math.cos(to[1] * rad) * Math.cos((to[0] - from[0]) * rad);
  return Math.round(((Math.atan2(y, x) / rad) + 360) % 360);
}

export class TruckSim {
  private trucks = new Map<string, Truck>();
  private runs = new Map<string, Run | null>();
  private pending = new Map<string, Run>();

  constructor(
    trucks: Truck[],
    private depot: Site,
    private deps: TruckSimDeps,
  ) {
    for (const t of trucks) {
      this.trucks.set(t.truck_id, { ...t, lat: depot.lat, lng: depot.lng, load_kg: 0, status: "idle", route_id: null, next_stop_bin_id: null, heading_deg: 0 });
      this.runs.set(t.truck_id, null);
    }
  }

  snapshot(): Truck[] {
    return [...this.trucks.values()].map((t) => ({ ...t }));
  }

  busy(): boolean {
    return [...this.runs.values()].some((r) => r !== null) || this.pending.size > 0;
  }

  /** Queue the plan's routes. A truck that is still driving finishes its route first. */
  loadPlan(plan: Plan, now: Date): void {
    const startAtMs = Math.max(now.getTime(), collectionStart(plan.date).getTime());
    const deferredIds = new Set(plan.deferred_zones.map((d) => d.zone_id));
    // one tracker per plan: a later plan must not erase an earlier plan's pending completion
    const tracker: PlanTracker = {
      date: plan.date,
      zones: plan.due_zones.filter((z) => !deferredIds.has(z)),
      remaining: new Set(),
    };
    for (const route of plan.routes) {
      const truck = this.trucks.get(route.truck_id);
      if (!truck || route.leg_distances_m?.length !== route.stops.length + 1 || route.geometry.length < 2) continue;
      const stopDist: number[] = [];
      let acc = 0;
      for (let i = 0; i < route.stops.length; i++) {
        acc += route.leg_distances_m[i]!;
        stopDist.push(acc);
      }
      const total = acc + route.leg_distances_m[route.stops.length]!;
      const primary = route.truck_kind === "primary_compactor";
      if (primary) tracker.remaining.add(route.route_id);
      const run: Run = {
        route,
        stopDist,
        total,
        geom: route.geometry,
        geomCum: cumulative(route.geometry),
        s: 0,
        next: 0,
        phase: "driving",
        dwellLeft: 0,
        startAtMs,
        tracker: primary ? tracker : null,
      };
      if (this.runs.get(route.truck_id)) this.pending.set(route.truck_id, run);
      else this.runs.set(route.truck_id, run);
    }
  }

  step(dtS: number, now: Date): void {
    for (const [id, truck] of this.trucks) {
      let run = this.runs.get(id) ?? null;
      if (!run) {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          this.runs.set(id, p);
          run = p;
        }
      }
      if (!run || now.getTime() < run.startAtMs) continue;
      this.advance(truck, run, dtS, now);
    }
  }

  private advance(truck: Truck, run: Run, dtS: number, now: Date): void {
    let rem = dtS;
    if (truck.status === "idle") this.setStatus(truck, run);
    while (rem > 0 && this.runs.get(truck.truck_id) === run) {
      if (run.phase === "driving") {
        const target = run.next < run.route.stops.length ? run.stopDist[run.next]! : run.total;
        const need = target - run.s;
        const t = need / MPS;
        if (t <= rem) {
          run.s = target;
          rem -= t;
          this.moveTo(truck, run);
          this.arrive(truck, run);
        } else {
          run.s += MPS * rem;
          rem = 0;
          this.moveTo(truck, run);
        }
      } else if (run.dwellLeft <= rem) {
        rem -= run.dwellLeft;
        this.finishDwell(truck, run, now);
      } else {
        run.dwellLeft -= rem;
        rem = 0;
      }
    }
  }

  private arrive(truck: Truck, run: Run): void {
    if (run.next >= run.route.stops.length) {
      this.finishRun(truck, run);
      return;
    }
    const stop = run.route.stops[run.next]!;
    run.phase = "dwell";
    run.dwellLeft = stop.type === "bin" ? config.serviceSecondsPerBin : config.unloadSeconds;
    truck.status = stop.type === "bin" ? "servicing" : "unloading";
  }

  private finishDwell(truck: Truck, run: Run, now: Date): void {
    const stop = run.route.stops[run.next]!;
    if (stop.type === "bin") {
      if (stop.load_after_kg > truck.capacity_kg) {
        throw new Error(`${truck.truck_id} would carry ${stop.load_after_kg} kg above capacity ${truck.capacity_kg} kg`);
      }
      truck.load_kg = stop.load_after_kg;
      this.deps.onCollect(stop.bin_id!, now);
    } else {
      truck.load_kg = 0;
    }
    run.next += 1;
    run.phase = "driving";
    this.setStatus(truck, run);
  }

  private setStatus(truck: Truck, run: Run): void {
    truck.route_id = run.route.route_id;
    if (run.next >= run.route.stops.length) {
      truck.status = "returning";
      truck.next_stop_bin_id = null;
      return;
    }
    const stop = run.route.stops[run.next]!;
    truck.status = stop.type === "dump_yard" ? "to_dump_yard" : "driving";
    truck.next_stop_bin_id = stop.type === "bin" ? stop.bin_id! : null;
  }

  private finishRun(truck: Truck, run: Run): void {
    truck.status = "idle";
    truck.load_kg = 0; // unloaded at the end of the shift
    truck.route_id = null;
    truck.next_stop_bin_id = null;
    truck.lat = this.depot.lat;
    truck.lng = this.depot.lng;
    this.runs.set(truck.truck_id, null);
    const tracker = run.tracker;
    if (tracker) {
      tracker.remaining.delete(run.route.route_id);
      if (tracker.remaining.size === 0) this.deps.onZonesCollected(tracker.zones, tracker.date);
    }
  }

  private moveTo(truck: Truck, run: Run): void {
    const frac = run.total > 0 ? Math.min(1, run.s / run.total) : 1;
    const dist = frac * run.geomCum[run.geomCum.length - 1]!;
    let i = 1;
    while (i < run.geomCum.length - 1 && run.geomCum[i]! < dist) i++;
    const a = run.geom[i - 1]!;
    const b = run.geom[i]!;
    const span = run.geomCum[i]! - run.geomCum[i - 1]!;
    const f = span > 0 ? (dist - run.geomCum[i - 1]!) / span : 1;
    const pos: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    if (haversineM(truck.lat, truck.lng, pos[1], pos[0]) > 0.5) {
      truck.heading_deg = bearing([truck.lng, truck.lat], pos);
    }
    truck.lng = pos[0];
    truck.lat = pos[1];
  }
}
