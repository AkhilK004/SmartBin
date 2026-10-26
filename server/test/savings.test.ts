import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { MemoryStore, loadSnapshot, saveSnapshot } from "../src/adapters/local.js";
import { config } from "../src/config.js";
import { buildPlan } from "../src/domain/dispatch.js";
import { buildSavings, daySavings } from "../src/domain/savings.js";
import { SavingsService } from "../src/savings.js";
import { SITES } from "../src/seed.js";
import type { Plan, PlanRoute, RouteStop, Savings } from "../src/types.js";
import { bin, fakeDeps, heavyLashkar, input } from "./dispatch.helpers.js";
import { listen, makeWorld } from "./helpers.js";
import { planWith, route } from "./sim.helpers.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const depot = SITES.find((s) => s.kind === "depot")!;
const stop = (id: string): RouteStop => ({ type: "bin", bin_id: id, lat: depot.lat, lng: depot.lng, load_after_kg: 10 });
const dumpStop: RouteStop = { type: "dump_yard", lat: depot.lat, lng: depot.lng, load_after_kg: 0 };
const withDistance = (r: PlanRoute, m: number): PlanRoute => ({ ...r, distance_m: m });

const baseline = (stops: number, km: number) => ({ stops, distance_m: km * 1000, duration_s: 1, vehicles_used: 1 });

function plan(date: string, routes: PlanRoute[], base: ReturnType<typeof baseline> | null, over: Partial<Plan> = {}): Plan {
  return planWith(routes, { date, baseline: base, ...over });
}

describe("daySavings", () => {
  it("counts bin stops (not dump visits), sums km and prices fuel per truck kind", () => {
    const p = plan(
      "2026-10-27",
      [
        withDistance(route("T-P1", "primary_compactor", [stop("A"), stop("B"), dumpStop, stop("C")], depot), 10_000),
        withDistance(route("T-S1", "secondary_autotipper", [stop("D")], depot), 5_000),
      ],
      baseline(12, 30),
    );
    const d = daySavings(p)!;
    expect(d.stops).toEqual({ baseline: 12, optimized: 4 });
    expect(d.km).toEqual({ baseline: 30, optimized: 15 });
    // optimized: 10 km x 0.35 + 5 km x 0.12 ; baseline: 30 km x 0.35 (primary compactors only)
    expect(d.fuel_l.optimized).toBeCloseTo(10 * config.fuelLPerKm.primary_compactor + 5 * config.fuelLPerKm.secondary_autotipper, 2);
    expect(d.fuel_l.baseline).toBeCloseTo(30 * config.fuelLPerKm.primary_compactor, 2);
  });

  it("returns null without a baseline, or when the optimizer failed", () => {
    expect(daySavings(plan("2026-10-27", [], null))).toBeNull();
    expect(daySavings(plan("2026-10-27", [], baseline(5, 10), { error: "primary route failed" }))).toBeNull();
  });

  it("no routes at all still compares: the optimized side is zero", () => {
    const d = daySavings(plan("2026-10-27", [], baseline(10, 20)))!;
    expect(d.stops).toEqual({ baseline: 10, optimized: 0 });
    expect(d.km.optimized).toBe(0);
    expect(d.fuel_l.optimized).toBe(0);
  });
});

describe("buildSavings", () => {
  const day = (b: number, o: number) => ({
    stops: { baseline: b, optimized: o },
    km: { baseline: b * 2, optimized: o * 2 },
    fuel_l: { baseline: b * 0.5, optimized: o * 0.5 },
  });
  const noOverflows = { by_date: {}, total: { baseline: 0, optimized: 0 } };

  it("is null with an empty ledger", () => {
    expect(buildSavings({}, noOverflows)).toBeNull();
  });

  it("shows the latest date and running totals over all dates", () => {
    const s = buildSavings({ "2026-10-26": day(40, 18), "2026-10-27": day(30, 10) }, noOverflows)!;
    expect(s.date).toBe("2026-10-27");
    expect(s.stops).toEqual({ baseline: 30, optimized: 10 });
    expect(s.cumulative.stops).toEqual({ baseline: 70, optimized: 28 });
    expect(s.cumulative.km).toEqual({ baseline: 140, optimized: 56 });
    expect(s.cumulative.fuel_l).toEqual({ baseline: 35, optimized: 14 });
  });

  it("overflows: the day's own counts, and a total that includes days without a plan", () => {
    const o = {
      by_date: { "2026-10-26": { baseline: 5, optimized: 2 }, "2026-10-27": { baseline: 3, optimized: 0 }, "2026-10-28": { baseline: 4, optimized: 1 } },
      total: { baseline: 12, optimized: 3 },
    };
    const s = buildSavings({ "2026-10-27": day(30, 10) }, o)!;
    expect(s.overflows_missed).toEqual({ baseline: 3, optimized: 0 });
    expect(s.cumulative.overflows_missed).toEqual({ baseline: 12, optimized: 3 });
  });

  it("labels fuel as an estimate and the data as simulated", () => {
    const s = buildSavings({ "2026-10-27": day(1, 1) }, noOverflows)!;
    expect(s.fuel_is_estimate).toBe(true);
    expect(s.simulated).toBe(true);
  });
});

describe("baseline definition (CLAUDE.md section 4)", () => {
  it("baseline stops equal every bin of the due zones, skipped and deferred bins included", async () => {
    const bins = [
      ...heavyLashkar(), // due, collected
      bin("lashkar", { fill_pct: 10 }), // due, but a skip bin: still in the baseline
      bin("morar", { fill_pct: 90 }), // not due: not in the baseline
    ];
    const p = await buildPlan(input(bins), fakeDeps());
    expect(p.due_zones).toEqual(["lashkar"]);
    expect(p.baseline!.stops).toBe(bins.filter((b) => b.zone_id === "lashkar").length);
    const d = daySavings(p)!;
    expect(d.stops.baseline).toBe(26);
    expect(d.stops.optimized).toBeLessThan(d.stops.baseline); // the skip bin is not visited
  });
});

describe("SavingsService", () => {
  function rig(overflows = { by_date: {} as Record<string, { baseline: number; optimized: number }>, total: { baseline: 0, optimized: 0 } }) {
    const store = new MemoryStore();
    const events = new EventEmitter();
    const service = new SavingsService(store, events, () => overflows);
    const emitted: Savings[] = [];
    events.on("savings:new", (s: Savings) => emitted.push(s));
    return { store, events, service, emitted, overflows };
  }
  const p = (date: string, km: number) => plan(date, [withDistance(route("T-P1", "primary_compactor", [stop("A")], depot), km * 1000)], baseline(10, 30));

  it("publishes after a plan and records the date", () => {
    const r = rig();
    r.events.emit("plan:new", p("2026-10-27", 10));
    expect(r.emitted).toHaveLength(1);
    expect(r.emitted[0]!.date).toBe("2026-10-27");
    expect(Object.keys(r.store.getLedger())).toEqual(["2026-10-27"]);
  });

  it("re-running the same day replaces that day, it does not double the totals", () => {
    const r = rig();
    r.events.emit("plan:new", p("2026-10-27", 10));
    r.events.emit("plan:new", p("2026-10-27", 12));
    expect(r.service.current()!.cumulative.km.optimized).toBe(12);
    expect(r.emitted).toHaveLength(2);
  });

  it("does not publish again when nothing changed", () => {
    const r = rig();
    r.events.emit("plan:new", p("2026-10-27", 10));
    r.events.emit("sim:tick");
    r.events.emit("sim:tick");
    expect(r.emitted).toHaveLength(1);
  });

  it("publishes when the simulator's overflow counts move", () => {
    const r = rig();
    r.events.emit("plan:new", p("2026-10-27", 10));
    r.overflows.by_date["2026-10-27"] = { baseline: 2, optimized: 0 };
    r.overflows.total = { baseline: 2, optimized: 0 };
    r.events.emit("sim:tick");
    expect(r.emitted).toHaveLength(2);
    expect(r.emitted[1]!.overflows_missed).toEqual({ baseline: 2, optimized: 0 });
  });

  it("ignores a plan that cannot be compared", () => {
    const r = rig();
    r.events.emit("plan:new", plan("2026-10-27", [], null));
    expect(r.emitted).toHaveLength(0);
    expect(r.service.current()).toBeNull();
  });

  it("survives a restart through the snapshot", async () => {
    const r = rig();
    r.events.emit("plan:new", p("2026-10-27", 10));
    const dir = await mkdtemp(join(tmpdir(), "smartbin-"));
    const path = join(dir, "s.json");
    await saveSnapshot(path, r.store.snapshot());
    const restored = new MemoryStore((await loadSnapshot(path))!);
    expect(restored.getLedger()["2026-10-27"]!.km.optimized).toBe(10);
    await rm(dir, { recursive: true });
  });
});

describe("savings over HTTP and sockets", () => {
  let world: ReturnType<typeof makeWorld>;
  let client: Socket | undefined;
  afterEach(async () => {
    client?.close();
    client = undefined;
    await world.socket.close();
    world.server.close();
  });

  it("GET /savings is 404 before a plan, then the savings; state:init carries it; savings:update is pushed", async () => {
    world = makeWorld({ planDeps: fakeDeps() });
    const base = await listen(world.server);
    expect((await fetch(`${base}/savings`)).status).toBe(404);

    client = connect(base);
    await new Promise((r) => client!.once("state:init", r));
    const pushed = new Promise<Savings>((r) => client!.once("savings:update", r));

    expect((await fetch(`${base}/jobs/daily`, { method: "POST" })).status).toBe(200);
    const s = (await (await fetch(`${base}/savings`)).json()) as Savings;
    expect(s.date).toBe("2026-10-26");
    expect(s.fuel_is_estimate).toBe(true);
    expect(s.simulated).toBe(true);
    expect((await pushed).date).toBe("2026-10-26");

    const state = (await (await fetch(`${base}/state`)).json()) as { savings: Savings };
    expect(state.savings.date).toBe("2026-10-26");
  });
});
