// Daily Collection Plan (CLAUDE.md §3, §4). Pure business logic: the optimizer and the road
// router are injected, so this module never touches a network or a cloud SDK.

import { config } from "../config.js";
import type { Settings } from "../settings.js";
import { localDate } from "../time.js";
import type {
  Bin,
  DistanceSource,
  OptimizeRequest,
  OptimizeResponse,
  OptimizeStop,
  Plan,
  PlanRoute,
  Site,
  Truck,
  TruckKind,
  Zone,
} from "../types.js";

export interface PlanDeps {
  optimize(req: OptimizeRequest): Promise<OptimizeResponse>;
  baseline(req: OptimizeRequest): Promise<OptimizeResponse>;
  roadRoute(points: { lat: number; lng: number }[]): Promise<{
    geometry: [number, number][];
    leg_distances_m: number[];
    distance_source: DistanceSource;
  }>;
}

export interface PlanInput {
  now: Date;
  bins: Bin[];
  zones: Zone[];
  trucks: Truck[];
  sites: Site[];
  settings: Settings;
  /** Solver time limit per optimizer call; defaults to config.optimizerTimeLimitS. */
  timeLimitS?: number;
}

export const demandKg = (b: Bin) => Math.round((b.fill_pct / 100) * config.binCapacityKg);

const toStop = (b: Bin, mandatory: boolean): OptimizeStop => ({
  bin_id: b.bin_id,
  lat: b.lat,
  lng: b.lng,
  demand_kg: demandKg(b),
  mandatory,
  priority: b.priority,
});

function urgentReason(b: Bin): string {
  const why: string[] = [];
  if (b.fill_pct >= config.thresholds.urgentAtPct) why.push(`fill ${b.fill_pct}%`);
  if (b.predicted_overflow) why.push(`predicted to overflow in ${b.hours_to_full} h`);
  if (b.hazard) why.push("hazard");
  return why.join(", ");
}

export async function buildPlan(input: PlanInput, deps: PlanDeps): Promise<Plan> {
  const { now, bins, zones, trucks, sites, settings } = input;
  const date = localDate(now);
  const decisions: string[] = [];
  const errors: string[] = [];
  const sources: DistanceSource[] = [];

  const depot = sites.find((s) => s.kind === "depot");
  const dump = sites.find((s) => s.kind === "dump_yard");
  if (!depot || !dump) throw new Error("depot and dump yard must be configured");

  const zoneName = (id: string) => zones.find((z) => z.zone_id === id)?.name ?? id;
  const nextAfterToday = (z: Zone) => z.calendar.find((d) => d > date) ?? "unknown";
  const binsOf = (zoneIds: Set<string>) => bins.filter((b) => zoneIds.has(b.zone_id));
  const vehiclesOf = (kind: TruckKind) =>
    trucks
      .filter((t) => t.kind === kind)
      .map((t) => ({ vehicle_id: t.truck_id, kind: t.kind, capacity_kg: t.capacity_kg }));
  const request = (kind: TruckKind, stops: OptimizeStop[]): OptimizeRequest => ({
    depot: { lat: depot.lat, lng: depot.lng },
    dump_yard: { lat: dump.lat, lng: dump.lng },
    vehicles: vehiclesOf(kind),
    stops,
    penalty_scale: settings.penalty_scale,
    time_limit_s: input.timeLimitS ?? config.optimizerTimeLimitS,
  });

  // 1-3. Due zones (calendar day is today), minus zones whose expected load is too small.
  const minLoadKg = config.minLoadFractionOfPrimary * config.fleet.capacityKg.primary_compactor;
  const due = zones.filter((z) => z.calendar.includes(date));
  const deferred: Plan["deferred_zones"] = [];
  const overridden: Zone["zone_id"][] = [];
  const active: Zone[] = [];
  for (const z of due) {
    const zbins = bins.filter((b) => b.zone_id === z.zone_id);
    const collectible = zbins.filter((b) => b.bin_class !== "skip");
    const load = collectible.reduce((s, b) => s + demandKg(b), 0);
    const count = (c: Bin["bin_class"]) => zbins.filter((b) => b.bin_class === c).length;
    const urgentCount = zbins.filter((b) => b.urgent).length;
    if (load < minLoadKg && urgentCount >= config.urgentOverrideCount) {
      // Urgent override: too many urgent bins to leave to the small trucks.
      overridden.push(z.zone_id);
      active.push(z);
      decisions.push(
        `Zone ${z.name} urgent override: ${urgentCount} urgent bins (>= ${config.urgentOverrideCount}) override the minimum load ` +
          `(expected ${load} kg < ${minLoadKg} kg); primary truck dispatched`,
      );
    } else if (load < minLoadKg) {
      deferred.push({
        zone_id: z.zone_id,
        expected_load_kg: load,
        min_load_kg: minLoadKg,
        next_collection_date: nextAfterToday(z),
      });
      decisions.push(
        `Zone ${z.name} deferred: expected load ${load} kg < ${minLoadKg} kg ` +
          `(${config.minLoadFractionOfPrimary * 100}% of ${config.fleet.capacityKg.primary_compactor} kg); ` +
          `next collection ${nextAfterToday(z)}`,
      );
    } else {
      active.push(z);
      decisions.push(
        `Zone ${z.name} due today: ${count("must_visit")} must-visit, ${count("visit_if_nearby")} visit-if-nearby, ` +
          `${count("skip")} skip; expected load ${load} kg`,
      );
    }
  }
  for (const z of zones.filter((z) => !due.includes(z))) {
    decisions.push(`Zone ${z.name} not due today; next collection ${nextAfterToday(z)}`);
  }

  // 4. Primary run over the active zones.
  const activeIds = new Set(active.map((z) => z.zone_id));
  const activeBins = binsOf(activeIds);
  const skip_list = activeBins
    .filter((b) => b.bin_class === "skip")
    .map((b) => ({ bin_id: b.bin_id, zone_id: b.zone_id, fill_pct: b.fill_pct }));
  if (skip_list.length > 0) {
    decisions.push(`Skip list: ${skip_list.length} bin(s) under ${settings.thresholds.skip_below_pct}% not visited`);
  }
  const primaryStops = activeBins
    .filter((b) => b.bin_class !== "skip")
    .map((b) => toStop(b, b.bin_class === "must_visit"));

  const routes: PlanRoute[] = [];
  const addRoutes = async (res: OptimizeResponse, kind: TruckKind) => {
    sources.push(res.distance_source);
    for (const r of res.routes) {
      const road = await deps.roadRoute([depot, ...r.stops, depot]);
      sources.push(road.distance_source);
      routes.push({
        route_id: `R-${date}-${r.vehicle_id}`,
        truck_id: r.vehicle_id,
        truck_kind: kind,
        stops: r.stops,
        distance_m: r.distance_m,
        duration_s: r.duration_s,
        geometry: road.geometry,
        leg_distances_m: road.leg_distances_m,
      });
    }
  };

  let dropped_optional: Plan["dropped_optional"] = [];
  if (primaryStops.length > 0) {
    if (vehiclesOf("primary_compactor").length === 0) {
      errors.push("no primary truck available");
    } else {
      try {
        const res = await deps.optimize(request("primary_compactor", primaryStops));
        await addRoutes(res, "primary_compactor");
        dropped_optional = res.dropped;
        decisions.push(...res.decisions);
      } catch (err) {
        errors.push(`primary route failed: ${(err as Error).message}`);
      }
    }
  }

  // 5. Zones with no primary run today: urgent bins -> secondary, standard bins wait.
  const idleZones = zones.filter((z) => !activeIds.has(z.zone_id));
  const waiting: Plan["waiting"] = [];
  const urgent: Bin[] = [];
  for (const z of idleZones) {
    const reason = deferred.some((d) => d.zone_id === z.zone_id) ? "deferred for low load" : "not due today";
    const zoneBins = bins.filter((b) => b.zone_id === z.zone_id);
    // secondary trucks take the highest-priority urgent bins, at most maxSecondaryUrgentPerZone per zone
    const urgentHere = zoneBins.filter((b) => b.urgent).sort((a, b) => b.priority - a.priority);
    urgent.push(...urgentHere.slice(0, config.maxSecondaryUrgentPerZone));
    for (const b of urgentHere.slice(config.maxSecondaryUrgentPerZone)) {
      const why =
        `urgent (${urgentReason(b)}) but ${zoneName(z.zone_id)} already has ${config.maxSecondaryUrgentPerZone} urgent bins on ` +
        `secondary trucks and is ${reason}; waits for ${nextAfterToday(z)}`;
      waiting.push({ bin_id: b.bin_id, zone_id: b.zone_id, fill_pct: b.fill_pct, reason: why });
      decisions.push(`Bin ${b.bin_id} waits: ${why}`);
    }
    for (const b of zoneBins) {
      if (b.urgent) continue;
      if (b.bin_class === "must_visit") {
        const why = `standard bin (fill ${b.fill_pct}%), no overflow predicted, no hazard; waits for ${zoneName(z.zone_id)} on ${nextAfterToday(z)} (${reason})`;
        waiting.push({ bin_id: b.bin_id, zone_id: b.zone_id, fill_pct: b.fill_pct, reason: why });
        decisions.push(`Bin ${b.bin_id} waits: ${why}`);
      }
    }
  }
  if (urgent.length > 0) {
    if (vehiclesOf("secondary_autotipper").length === 0) {
      for (const b of urgent) {
        const why = "urgent but no secondary truck available";
        waiting.push({ bin_id: b.bin_id, zone_id: b.zone_id, fill_pct: b.fill_pct, reason: why });
        decisions.push(`Bin ${b.bin_id} ${why}`);
      }
    } else {
      try {
        const res = await deps.optimize(
          request("secondary_autotipper", urgent.map((b) => toStop(b, true))),
        );
        await addRoutes(res, "secondary_autotipper");
        const byId = new Map(urgent.map((b) => [b.bin_id, b]));
        for (const r of res.routes) {
          for (const s of r.stops) {
            const b = s.bin_id ? byId.get(s.bin_id) : undefined;
            if (b) {
              decisions.push(
                `Bin ${b.bin_id} urgent (${urgentReason(b)}) in ${zoneName(b.zone_id)}, no primary run today: ` +
                  `secondary truck ${r.vehicle_id}`,
              );
            }
          }
        }
        decisions.push(...res.decisions);
      } catch (err) {
        errors.push(`secondary route failed: ${(err as Error).message}`);
      }
    }
  }

  // 6. Fixed-route baseline: every bin of every due zone (deferred ones included), no skipping.
  let baseline: Plan["baseline"] = null;
  const dueBins = binsOf(new Set(due.map((z) => z.zone_id)));
  if (dueBins.length > 0 && vehiclesOf("primary_compactor").length > 0) {
    try {
      const res = await deps.baseline(
        request("primary_compactor", dueBins.map((b) => toStop(b, true))),
      );
      baseline = {
        stops: res.routes.reduce((n, r) => n + r.stops.filter((s) => s.type === "bin").length, 0),
        distance_m: res.routes.reduce((n, r) => n + r.distance_m, 0),
        duration_s: res.routes.reduce((n, r) => n + r.duration_s, 0),
        vehicles_used: res.routes.length,
      };
      sources.push(res.distance_source);
    } catch (err) {
      decisions.push(`Baseline unavailable: ${(err as Error).message}`);
    }
  }

  return {
    date,
    generated_at: now.toISOString(),
    due_zones: due.map((z) => z.zone_id),
    deferred_zones: deferred,
    urgent_override_zones: overridden,
    routes,
    skip_list,
    dropped_optional,
    waiting,
    distance_source: sources.length === 0 ? null : sources.includes("haversine_fallback") ? "haversine_fallback" : "osrm",
    baseline,
    decisions,
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}
