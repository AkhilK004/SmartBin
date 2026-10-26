import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { haversineM } from "../src/geo.js";
import { SITES, seedFleet } from "../src/seed.js";
import { TruckSim } from "../src/sim/trucks.js";
import { collectionStart } from "../src/time.js";
import type { RouteStop } from "../src/types.js";
import { NOW } from "./helpers.js";
import { planWith, route } from "./sim.helpers.js";

const depot = SITES.find((s) => s.kind === "depot")!;
const dump = SITES.find((s) => s.kind === "dump_yard")!;
// NOW is 15:30 local, after the 06:00 run start, so routes begin at once

const bin = (id: string, dNorthKm: number, load: number): RouteStop => ({
  type: "bin",
  bin_id: id,
  lat: depot.lat + dNorthKm * 0.009,
  lng: depot.lng,
  load_after_kg: load,
});
const dumpStop: RouteStop = { type: "dump_yard", lat: dump.lat, lng: dump.lng, load_after_kg: 0 };

function rig() {
  const collected: { id: string; at: Date }[] = [];
  const zones: { zones: string[]; date: string }[] = [];
  const sim = new TruckSim(seedFleet(), depot, {
    onCollect: (id, at) => collected.push({ id, at }),
    onZonesCollected: (z, date) => zones.push({ zones: z, date }),
  });
  const truck = (id: string) => sim.snapshot().find((t) => t.truck_id === id)!;
  let t = NOW;
  const run = (seconds: number, dt = 10) => {
    for (let done = 0; done < seconds; done += dt) {
      t = new Date(t.getTime() + dt * 1000);
      sim.step(dt, t);
    }
  };
  return { sim, collected, zones, truck, run, now: () => t };
}

describe("truck simulator", () => {
  it("drives to a bin, dwells, empties it, returns and goes idle", () => {
    const r = rig();
    r.sim.loadPlan(planWith([route("T-P1", "primary_compactor", [bin("B-1", 1, 100)], depot)], { due_zones: ["lashkar"] }), NOW);

    r.run(10);
    expect(r.truck("T-P1").status).toBe("driving");
    expect(r.truck("T-P1").route_id).toBe("R-2026-10-26-T-P1");
    expect(r.truck("T-P1").next_stop_bin_id).toBe("B-1");
    expect(r.truck("T-P1").lat).toBeGreaterThan(depot.lat);

    // 1 km x 1.4 at 22 km/h = 229 s to arrive; then 60 s of service
    r.run(240);
    expect(r.truck("T-P1").status).toBe("servicing");
    expect(r.collected).toHaveLength(0);
    r.run(60);
    expect(r.collected.map((c) => c.id)).toEqual(["B-1"]);
    expect(r.truck("T-P1").load_kg).toBe(100);
    expect(r.truck("T-P1").status).toBe("returning");

    r.run(400);
    const t = r.truck("T-P1");
    expect(t.status).toBe("idle");
    expect(t.load_kg).toBe(0);
    expect(t.route_id).toBeNull();
    expect(haversineM(t.lat, t.lng, depot.lat, depot.lng)).toBeLessThan(1);
  });

  it("travels at the configured speed", () => {
    const r = rig();
    r.sim.loadPlan(planWith([route("T-P1", "primary_compactor", [bin("B-1", 5, 100)], depot)]), NOW);
    r.run(100);
    const t = r.truck("T-P1");
    const km = haversineM(depot.lat, depot.lng, t.lat, t.lng) / 1000;
    // 100 s at 22 km/h = 611 m of road; straight-line geometry is shorter than the x1.4 road distance
    expect(km * 1.4).toBeCloseTo((config.truckSpeedKmh * 100) / 3600, 1);
  });

  it("unloads at the dump yard, resets load, then keeps collecting; load never exceeds capacity", () => {
    const r = rig();
    const stops = [bin("B-1", 1, 400), bin("B-2", 1.2, 800), dumpStop, bin("B-3", 1.4, 400)];
    r.sim.loadPlan(planWith([route("T-S1", "secondary_autotipper", stops, depot)]), NOW);
    const loads: number[] = [];
    const statuses = new Set<string>();
    for (let i = 0; i < 400; i++) {
      r.run(10);
      const t = r.truck("T-S1");
      loads.push(t.load_kg);
      statuses.add(t.status);
    }
    expect(r.collected.map((c) => c.id)).toEqual(["B-1", "B-2", "B-3"]);
    expect(Math.max(...loads)).toBeLessThanOrEqual(800);
    expect(statuses.has("to_dump_yard")).toBe(true);
    expect(statuses.has("unloading")).toBe(true);
    expect(r.truck("T-S1").status).toBe("idle");
  });

  it("refuses to carry more than capacity (invariant 7 guard)", () => {
    const r = rig();
    r.sim.loadPlan(planWith([route("T-S1", "secondary_autotipper", [bin("B-1", 0.2, 900)], depot)]), NOW);
    expect(() => r.run(600)).toThrow(/above capacity/);
  });

  it("waits for the collection start when the plan is built earlier", () => {
    const planBuilt = new Date("2026-10-25T19:00:00Z"); // 00:30 IST on 26 Oct, before the 06:00 start
    const sim = new TruckSim(seedFleet(), depot, { onCollect: () => {}, onZonesCollected: () => {} });
    sim.loadPlan(planWith([route("T-P1", "primary_compactor", [bin("B-1", 1, 50)], depot)]), planBuilt);
    const status = () => sim.snapshot().find((t) => t.truck_id === "T-P1")!.status;

    sim.step(60, new Date(planBuilt.getTime() + 60_000));
    expect(status()).toBe("idle");
    sim.step(30, new Date(collectionStart("2026-10-26").getTime() + 30_000));
    expect(status()).toBe("driving");
  });

  it("reports the plan's active zones as collected once every primary route is done", () => {
    const r = rig();
    const plan = planWith(
      [
        route("T-P1", "primary_compactor", [bin("B-1", 1, 50)], depot),
        route("T-P2", "primary_compactor", [bin("B-2", 3, 50)], depot),
        route("T-S1", "secondary_autotipper", [bin("B-9", 0.5, 50)], depot),
      ],
      {
        due_zones: ["lashkar", "morar"],
        deferred_zones: [{ zone_id: "morar", expected_load_kg: 10, min_load_kg: 2400, next_collection_date: "2026-10-28" }],
      },
    );
    r.sim.loadPlan(plan, NOW);
    r.run(600);
    expect(r.zones).toHaveLength(0); // T-P2 is still out
    r.run(900);
    expect(r.zones).toEqual([{ zones: ["lashkar"], date: "2026-10-26" }]);
    expect(r.sim.busy()).toBe(false);
  });

  it("a later plan does not erase the completion of an earlier plan that is still out", () => {
    const r = rig();
    const planA = planWith([route("T-P1", "primary_compactor", [bin("B-1", 3, 50)], depot)], { due_zones: ["lashkar"] });
    const planB = planWith([route("T-P2", "primary_compactor", [bin("B-2", 1, 50)], depot)], { due_zones: ["morar"] });
    r.sim.loadPlan(planA, NOW);
    r.run(120);
    r.sim.loadPlan(planB, r.now()); // arrives while plan A's truck is still driving
    r.run(3000);
    // B's shorter route finishes first; A is still reported afterwards
    expect(r.zones).toEqual([
      { zones: ["morar"], date: "2026-10-26" },
      { zones: ["lashkar"], date: "2026-10-26" },
    ]);
  });

  it("a truck that is still driving finishes its route before the next plan's route starts", () => {
    const r = rig();
    r.sim.loadPlan(planWith([route("T-P1", "primary_compactor", [bin("B-1", 2, 50)], depot)]), NOW);
    r.run(60);
    r.sim.loadPlan(planWith([route("T-P1", "primary_compactor", [bin("B-2", 1, 50)], depot)]), r.now());
    r.run(2000);
    expect(r.collected.map((c) => c.id)).toEqual(["B-1", "B-2"]);
  });

  it("ignores routes without leg distances", () => {
    const r = rig();
    const bad = route("T-P1", "primary_compactor", [bin("B-1", 1, 50)], depot);
    bad.leg_distances_m = [];
    r.sim.loadPlan(planWith([bad]), NOW);
    r.run(600);
    expect(r.collected).toHaveLength(0);
    expect(r.truck("T-P1").status).toBe("idle");
  });
});
