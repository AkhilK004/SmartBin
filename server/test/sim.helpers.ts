import { haversineM } from "../src/geo.js";
import type { PlanDeps } from "../src/domain/dispatch.js";
import { runDailyJob, runFrequencyJob } from "../src/jobs.js";
import { SimClock } from "../src/sim/clock.js";
import { SimEngine } from "../src/sim/engine.js";
import type { OptimizeRequest, OptimizeResponse, Plan, PlanRoute, RouteStop, TruckKind } from "../src/types.js";
import { FakeHistory, NOW, makeWorld } from "./helpers.js";

/** Straight-line geometry with road-like legs (x1.4). */
const straight: PlanDeps["roadRoute"] = async (pts) => ({
  geometry: pts.map((p) => [p.lng, p.lat] as [number, number]),
  leg_distances_m: pts.slice(1).map((p, i) => Math.round(haversineM(pts[i]!.lat, pts[i]!.lng, p.lat, p.lng) * 1.4)),
  distance_source: "osrm",
});

/**
 * Fake optimizer: one route per call over every stop in order, with a dump-yard visit
 * whenever the next bin would not fit the truck. Optional stops are all kept.
 */
export function chunkingDeps(): PlanDeps {
  const respond = (req: OptimizeRequest): OptimizeResponse => {
    const v = req.vehicles[0]!;
    const stops: RouteStop[] = [];
    let load = 0;
    for (const s of req.stops) {
      if (load + s.demand_kg > v.capacity_kg) {
        stops.push({ type: "dump_yard", lat: req.dump_yard.lat, lng: req.dump_yard.lng, load_after_kg: 0 });
        load = 0;
      }
      load += s.demand_kg;
      stops.push({ type: "bin", bin_id: s.bin_id, lat: s.lat, lng: s.lng, load_after_kg: load });
    }
    return {
      routes: stops.length ? [{ vehicle_id: v.vehicle_id, stops, distance_m: 1000, duration_s: 600 }] : [],
      dropped: [],
      distance_source: "osrm",
      decisions: [],
    };
  };
  return { optimize: async (r) => respond(r), baseline: async (r) => respond(r), roadRoute: straight };
}

export function simWorld(opts: { start?: Date; planDeps?: PlanDeps; jobs?: boolean } = {}) {
  const clock = new SimClock(opts.start ?? NOW);
  const world = makeWorld({ clock: () => clock.now(), planDeps: opts.planDeps ?? chunkingDeps() });
  const jobs: string[] = [];
  const engine = new SimEngine({
    store: world.store,
    history: world.history,
    pipeline: world.pipeline,
    clock,
    sim: world.ctx.sim,
    publish: async (readings) => {
      for (const r of readings) await world.bus.publish(r);
    },
    callJob: async (path) => {
      jobs.push(path);
      if (opts.jobs === false) return; // no plans: nothing is ever collected
      if (path === "/jobs/daily") await runDailyJob(world.ctx);
      else runFrequencyJob(world.ctx);
    },
  });
  world.ctx.simControl = engine;
  return { ...world, clock, engine, jobs };
}

/** Advance in chunks so awaited work (jobs, readings) runs between them. */
export async function runFor(engine: SimEngine, seconds: number, chunk = 600): Promise<void> {
  for (let done = 0; done < seconds; done += chunk) {
    await engine.advance(Math.min(chunk, seconds - done));
    await new Promise((r) => setTimeout(r, 0));
  }
}

export function planWith(routes: PlanRoute[], over: Partial<Plan> = {}): Plan {
  return {
    date: "2026-10-26",
    generated_at: NOW.toISOString(),
    due_zones: [],
    urgent_override_zones: [],
    deferred_zones: [],
    routes,
    skip_list: [],
    dropped_optional: [],
    waiting: [],
    distance_source: "osrm",
    baseline: null,
    decisions: [],
    error: null,
    ...over,
  };
}

export function route(
  truck_id: string,
  kind: TruckKind,
  stops: RouteStop[],
  depot: { lat: number; lng: number },
): PlanRoute {
  const pts = [depot, ...stops, depot];
  const legs = pts.slice(1).map((p, i) => Math.round(haversineM(pts[i]!.lat, pts[i]!.lng, p.lat, p.lng) * 1.4));
  return {
    route_id: `R-2026-10-26-${truck_id}`,
    truck_id,
    truck_kind: kind,
    stops,
    distance_m: legs.reduce((a, b) => a + b, 0),
    duration_s: 0,
    geometry: pts.map((p) => [p.lng, p.lat] as [number, number]),
    leg_distances_m: legs,
  };
}

export { FakeHistory };
