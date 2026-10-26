import type { PlanDeps, PlanInput } from "../src/domain/dispatch.js";
import { deriveBin } from "../src/domain/classify.js";
import { SITES, seedFleet } from "../src/seed.js";
import { defaultSettings } from "../src/settings.js";
import type { Bin, BinBase, OptimizeRequest, OptimizeResponse, Plan, Zone, ZoneId } from "../src/types.js";
import { NOW } from "./helpers.js";

// NOW = 2026-10-26 15:30 IST. lashkar is due today; morar is not.
export const zone = (zone_id: ZoneId, name: string, calendar: string[]): Zone => ({
  zone_id,
  name,
  polygon: [],
  fill_rate_pct_per_day: 30,
  days_to_85: 2.5,
  interval_days: 2,
  interval_label: "every_2_days",
  last_collection_date: "2026-10-24",
  next_collection_date: calendar[0]!,
  calendar,
});

export const LASHKAR = zone("lashkar", "Lashkar", ["2026-10-26", "2026-10-28", "2026-10-30"]);
export const MORAR = zone("morar", "Morar", ["2026-10-27", "2026-10-29", "2026-10-31"]);

let counter = 0;
// slow fill rate keeps predicted overflow out of the way unless a test asks for it
export function bin(zoneId: ZoneId, over: Partial<BinBase> = {}, settings = defaultSettings(), zones = [LASHKAR, MORAR]): Bin {
  counter += 1;
  const base: BinBase = {
    bin_id: over.bin_id ?? `B-${String(counter).padStart(3, "0")}`,
    zone_id: zoneId,
    location_type: "residential",
    lat: 26.2 + counter * 0.0005,
    lng: 78.19,
    fill_pct: 50,
    fill_rate_pct_per_hour: 0.1,
    battery: 90,
    temp_c: 30,
    gas_ppm: 100,
    complaint: false,
    status: "online",
    last_seen: NOW.toISOString(),
    last_emptied: "2026-10-25T10:00:00Z",
    ...over,
  };
  return deriveBin(base, zones.find((z) => z.zone_id === zoneId)!, settings, NOW);
}

/** A due zone that clears the 2400 kg minimum load: 25 bins at 80% of 120 kg = 96 kg each. */
export const heavyLashkar = () => Array.from({ length: 25 }, () => bin("lashkar", { fill_pct: 80 }));

export function input(bins: Bin[], over: Partial<PlanInput> = {}): PlanInput {
  return {
    now: NOW,
    bins,
    zones: [LASHKAR, MORAR],
    trucks: seedFleet(),
    sites: SITES,
    settings: defaultSettings(),
    ...over,
  };
}

export interface FakeDeps extends PlanDeps {
  optimizeCalls: OptimizeRequest[];
  baselineCalls: OptimizeRequest[];
}

/** One route per call over all stops in order. Optional stop ids in `drop` are dropped. */
export function fakeDeps(opts: { drop?: string[]; failOptimize?: string } = {}): FakeDeps {
  const respond = (req: OptimizeRequest, drop: string[]): OptimizeResponse => {
    const kept = req.stops.filter((s) => !drop.includes(s.bin_id));
    let load = 0;
    return {
      routes:
        kept.length === 0
          ? []
          : [
              {
                vehicle_id: req.vehicles[0]!.vehicle_id,
                stops: kept.map((s) => ({ type: "bin" as const, bin_id: s.bin_id, lat: s.lat, lng: s.lng, load_after_kg: (load += s.demand_kg) })),
                distance_m: 1000 * kept.length,
                duration_s: 600 * kept.length,
              },
            ],
      dropped: req.stops.filter((s) => drop.includes(s.bin_id)).map((s) => ({ bin_id: s.bin_id, reason: "detour outweighs value" })),
      distance_source: "osrm",
      decisions: drop.filter((d) => req.stops.some((s) => s.bin_id === d)).map((d) => `${d} dropped: detour outweighs value`),
    };
  };
  const deps: FakeDeps = {
    optimizeCalls: [],
    baselineCalls: [],
    optimize: async (req) => {
      deps.optimizeCalls.push(req);
      if (opts.failOptimize) throw new Error(opts.failOptimize);
      return respond(req, opts.drop ?? []);
    },
    baseline: async (req) => {
      deps.baselineCalls.push(req);
      return respond(req, []);
    },
    roadRoute: async (pts) => ({
      geometry: pts.map((p) => [p.lng, p.lat] as [number, number]),
      leg_distances_m: pts.slice(1).map(() => 1000),
      distance_source: "osrm",
    }),
  };
  return deps;
}

export const routedBinIds = (plan: Plan) =>
  new Set(plan.routes.flatMap((r) => r.stops.filter((s) => s.type === "bin").map((s) => s.bin_id!)));
