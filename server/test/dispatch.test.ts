import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/domain/dispatch.js";
import { rollCalendars } from "../src/domain/frequency.js";
import { bin, fakeDeps, heavyLashkar, input, routedBinIds, LASHKAR } from "./dispatch.helpers.js";

const decisionsMention = (plan: { decisions: string[] }, text: string) =>
  plan.decisions.some((d) => d.includes(text));

describe("dispatch: standard bin in a non-due zone (invariant 1)", () => {
  it("88% bin, no overflow, no hazard -> no dispatch, decision logged", async () => {
    const lone = bin("morar", { bin_id: "B-LONE", fill_pct: 88 });
    expect(lone.bin_class).toBe("must_visit");
    expect(lone.urgent).toBe(false);

    const deps = fakeDeps();
    const plan = await buildPlan(input([...heavyLashkar(), lone]), deps);

    expect(routedBinIds(plan).has("B-LONE")).toBe(false);
    expect(plan.routes.every((r) => r.truck_kind === "primary_compactor")).toBe(true);
    expect(deps.optimizeCalls.every((c) => !c.stops.some((s) => s.bin_id === "B-LONE"))).toBe(true);
    expect(plan.waiting).toEqual([expect.objectContaining({ bin_id: "B-LONE", zone_id: "morar" })]);
    expect(decisionsMention(plan, "Bin B-LONE waits")).toBe(true);
    expect(plan.error).toBeNull();
  });
});

describe("dispatch: lone urgent bin (invariant 4)", () => {
  it("96% bin in a non-due zone goes to a secondary truck, never a primary", async () => {
    const urgent = bin("morar", { bin_id: "B-URG", fill_pct: 96 });
    expect(urgent.urgent).toBe(true);

    const deps = fakeDeps();
    const plan = await buildPlan(input([...heavyLashkar(), urgent]), deps);

    const route = plan.routes.find((r) => r.stops.some((s) => s.bin_id === "B-URG"))!;
    expect(route.truck_kind).toBe("secondary_autotipper");
    expect(route.truck_id).toMatch(/^T-S/);
    const call = deps.optimizeCalls.find((c) => c.stops.some((s) => s.bin_id === "B-URG"))!;
    expect(call.vehicles.every((v) => v.kind === "secondary_autotipper")).toBe(true);
    expect(call.stops.find((s) => s.bin_id === "B-URG")!.mandatory).toBe(true);
    expect(decisionsMention(plan, "Bin B-URG urgent")).toBe(true);
    expect(decisionsMention(plan, "secondary truck")).toBe(true);
  });

  it("hazard and predicted overflow are urgent even at low fill", async () => {
    const hazard = bin("morar", { bin_id: "B-HAZ", fill_pct: 20, gas_ppm: 450 });
    const soon = bin("morar", { bin_id: "B-SOON", fill_pct: 60, fill_rate_pct_per_hour: 5 });
    expect(soon.predicted_overflow).toBe(true);
    const plan = await buildPlan(input([...heavyLashkar(), hazard, soon]), fakeDeps());
    const secondary = plan.routes.find((r) => r.truck_kind === "secondary_autotipper")!;
    const ids = secondary.stops.map((s) => s.bin_id);
    expect(ids).toContain("B-HAZ");
    expect(ids).toContain("B-SOON");
  });

  it("an urgent bin in a deferred due zone also goes to a secondary truck", async () => {
    const urgent = bin("lashkar", { bin_id: "B-DEF-URG", fill_pct: 97 });
    const plan = await buildPlan(input([urgent, bin("lashkar", { fill_pct: 50 })]), fakeDeps());
    expect(plan.deferred_zones.map((d) => d.zone_id)).toEqual(["lashkar"]);
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0]!.truck_kind).toBe("secondary_autotipper");
  });

  it("with no secondary truck the urgent bin is listed as waiting, with a decision", async () => {
    const urgent = bin("morar", { bin_id: "B-URG", fill_pct: 96 });
    const trucks = input([]).trucks.filter((t) => t.kind === "primary_compactor");
    const plan = await buildPlan(input([...heavyLashkar(), urgent], { trucks }), fakeDeps());
    expect(plan.waiting.map((w) => w.bin_id)).toContain("B-URG");
    expect(decisionsMention(plan, "no secondary truck")).toBe(true);
  });
});

describe("dispatch: minimum load (invariant 3)", () => {
  it("defers a due zone whose expected load is under 40% of a primary truck", async () => {
    const small = [bin("lashkar", { fill_pct: 50 }), bin("lashkar", { fill_pct: 60 })]; // 60 + 72 kg
    const deps = fakeDeps();
    const plan = await buildPlan(input(small), deps);

    expect(plan.deferred_zones).toEqual([
      { zone_id: "lashkar", expected_load_kg: 132, min_load_kg: 2400, next_collection_date: "2026-10-28" },
    ]);
    expect(plan.due_zones).toEqual(["lashkar"]);
    expect(deps.optimizeCalls).toHaveLength(0);
    expect(plan.routes).toHaveLength(0);
    expect(decisionsMention(plan, "Zone Lashkar deferred")).toBe(true);
  });

  it("a zone exactly at the minimum is collected", async () => {
    const plan = await buildPlan(input(heavyLashkar()), fakeDeps()); // 25 x 96 = 2400 kg
    expect(plan.deferred_zones).toEqual([]);
    expect(plan.routes).toHaveLength(1);
  });

  it("skip bins do not count towards the expected load", async () => {
    const bins = [...Array.from({ length: 6 }, () => bin("lashkar", { fill_pct: 39 })), bin("lashkar", { fill_pct: 60 })];
    const plan = await buildPlan(input(bins), fakeDeps());
    expect(plan.deferred_zones[0]!.expected_load_kg).toBe(72);
  });
});

describe("dispatch: planned days and skip list (invariants 2 and 6)", () => {
  it("primary trucks only serve due zones", async () => {
    const morarBins = Array.from({ length: 8 }, () => bin("morar", { fill_pct: 80 }));
    const deps = fakeDeps();
    const plan = await buildPlan(input([...heavyLashkar(), ...morarBins]), deps);
    const primaryStops = deps.optimizeCalls.find((c) => c.vehicles[0]!.kind === "primary_compactor")!.stops;
    expect(primaryStops.every((s) => !morarBins.some((m) => m.bin_id === s.bin_id))).toBe(true);
    expect(plan.due_zones).toEqual(["lashkar"]);
  });

  it("skip bins are never sent to the optimizer or routed; they are on the skip list", async () => {
    const skips = [bin("lashkar", { bin_id: "B-S1", fill_pct: 20 }), bin("lashkar", { bin_id: "B-S2", fill_pct: 39.9 })];
    const deps = fakeDeps();
    const plan = await buildPlan(input([...heavyLashkar(), ...skips]), deps);

    for (const call of deps.optimizeCalls) {
      expect(call.stops.some((s) => s.bin_id === "B-S1" || s.bin_id === "B-S2")).toBe(false);
    }
    expect(routedBinIds(plan).has("B-S1")).toBe(false);
    expect(plan.skip_list.map((s) => s.bin_id).sort()).toEqual(["B-S1", "B-S2"]);
  });

  it("must-visit stops are mandatory and visit-if-nearby stops are optional with their priority", async () => {
    const must = bin("lashkar", { bin_id: "B-MUST", fill_pct: 92 });
    const near = bin("lashkar", { bin_id: "B-NEAR", fill_pct: 60 });
    const deps = fakeDeps();
    await buildPlan(input([...heavyLashkar(), must, near]), deps);
    const stops = deps.optimizeCalls[0]!.stops;
    expect(stops.find((s) => s.bin_id === "B-MUST")!.mandatory).toBe(true);
    const opt = stops.find((s) => s.bin_id === "B-NEAR")!;
    expect(opt.mandatory).toBe(false);
    expect(opt.priority).toBe(near.priority);
  });

  it("passes penalty_scale from settings", async () => {
    const settings = input([]).settings;
    settings.penalty_scale = 123;
    const deps = fakeDeps();
    await buildPlan(input(heavyLashkar(), { settings }), deps);
    expect(deps.optimizeCalls[0]!.penalty_scale).toBe(123);
  });
});

describe("dispatch: decisions explain every outcome (invariant 9)", () => {
  it("dropped optional bins appear in dropped_optional and in decisions", async () => {
    const near = bin("lashkar", { bin_id: "B-NEAR", fill_pct: 60 });
    const plan = await buildPlan(input([...heavyLashkar(), near]), fakeDeps({ drop: ["B-NEAR"] }));
    expect(plan.dropped_optional.map((d) => d.bin_id)).toEqual(["B-NEAR"]);
    expect(decisionsMention(plan, "B-NEAR dropped")).toBe(true);
    expect(routedBinIds(plan).has("B-NEAR")).toBe(false);
  });

  it("every deferred zone, waiting bin and secondary dispatch has a decision line", async () => {
    const bins = [
      bin("lashkar", { fill_pct: 50 }),
      bin("morar", { bin_id: "B-W", fill_pct: 90 }),
      bin("morar", { bin_id: "B-U", fill_pct: 99 }),
    ];
    const plan = await buildPlan(input(bins), fakeDeps());
    for (const d of plan.deferred_zones) expect(decisionsMention(plan, `deferred`)).toBe(true);
    for (const w of plan.waiting) expect(decisionsMention(plan, w.bin_id)).toBe(true);
    for (const r of plan.routes.filter((r) => r.truck_kind === "secondary_autotipper")) {
      for (const s of r.stops) expect(decisionsMention(plan, s.bin_id!)).toBe(true);
    }
    expect(plan.decisions.length).toBeGreaterThanOrEqual(4);
  });
});

describe("dispatch: baseline and errors", () => {
  it("baseline covers every bin of every due zone, deferred and skipped included", async () => {
    const lashkar = [bin("lashkar", { fill_pct: 20 }), bin("lashkar", { fill_pct: 50 })]; // deferred zone
    const morar = [bin("morar", { fill_pct: 90 })];
    const deps = fakeDeps();
    const plan = await buildPlan(input([...lashkar, ...morar]), deps);
    expect(deps.baselineCalls).toHaveLength(1);
    expect(deps.baselineCalls[0]!.stops.map((s) => s.bin_id).sort()).toEqual(lashkar.map((b) => b.bin_id).sort());
    expect(deps.baselineCalls[0]!.stops.every((s) => s.mandatory)).toBe(true);
    expect(plan.baseline).toMatchObject({ stops: 2 });
  });

  it("an optimizer failure becomes plan.error, never an empty plan without a reason", async () => {
    const plan = await buildPlan(input(heavyLashkar()), fakeDeps({ failOptimize: "optimizer 422: infeasible" }));
    expect(plan.error).toMatch(/primary route failed.*infeasible/);
    expect(plan.routes).toEqual([]);
  });

  it("distance_source is null with no routes and flags a fallback", async () => {
    const empty = await buildPlan(input([bin("lashkar", { fill_pct: 10 })], { zones: [{ ...LASHKAR, calendar: ["2026-10-27"] }] }), fakeDeps());
    expect(empty.distance_source).toBeNull();

    const deps = fakeDeps();
    const orig = deps.optimize;
    deps.optimize = async (r) => ({ ...(await orig(r)), distance_source: "haversine_fallback" });
    const plan = await buildPlan(input(heavyLashkar()), deps);
    expect(plan.distance_source).toBe("haversine_fallback");
  });

  it("no zone is due when no calendar contains today", async () => {
    const plan = await buildPlan(input(heavyLashkar(), { zones: [{ ...LASHKAR, calendar: ["2026-10-27"] }] }), fakeDeps());
    expect(plan.due_zones).toEqual([]);
    expect(plan.routes).toEqual([]);
  });
});

describe("rollCalendars", () => {
  it("moves the calendar forward without changing the rate", () => {
    const [rolled] = rollCalendars([LASHKAR], "2026-10-29");
    expect(rolled!.calendar[0]! >= "2026-10-29").toBe(true);
    expect(rolled!.fill_rate_pct_per_day).toBe(LASHKAR.fill_rate_pct_per_day);
  });
});

describe("dispatch: urgent override and secondary cap", () => {
  const urgentBins = (zoneId: "lashkar" | "morar", n: number) =>
    Array.from({ length: n }, (_, i) => bin(zoneId, { bin_id: `U-${zoneId}-${i}`, fill_pct: 96 + (i % 3) }));

  it("3 urgent bins in a below-minimum due zone send the primary truck", async () => {
    const small = [...urgentBins("lashkar", 3), bin("lashkar", { fill_pct: 50 })]; // ~ 350 kg, far below 2400
    const deps = fakeDeps();
    const plan = await buildPlan(input(small), deps);

    expect(plan.urgent_override_zones).toEqual(["lashkar"]);
    expect(plan.deferred_zones).toEqual([]);
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0]!.truck_kind).toBe("primary_compactor");
    expect(routedBinIds(plan).size).toBe(4);
    expect(deps.optimizeCalls.every((c) => c.vehicles.every((v) => v.kind === "primary_compactor"))).toBe(true);
    expect(decisionsMention(plan, "Zone Lashkar urgent override: 3 urgent bins")).toBe(true);
  });

  it("2 urgent bins do not override: the zone is deferred and both go to a secondary truck", async () => {
    const small = [...urgentBins("lashkar", 2), bin("lashkar", { fill_pct: 50 })];
    const deps = fakeDeps();
    const plan = await buildPlan(input(small), deps);

    expect(plan.urgent_override_zones).toEqual([]);
    expect(plan.deferred_zones.map((d) => d.zone_id)).toEqual(["lashkar"]);
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0]!.truck_kind).toBe("secondary_autotipper");
    expect(routedBinIds(plan)).toEqual(new Set(["U-lashkar-0", "U-lashkar-1"]));
  });

  it("a zone that already clears the minimum load is not flagged as an override", async () => {
    const plan = await buildPlan(input([...heavyLashkar(), ...urgentBins("lashkar", 3)]), fakeDeps());
    expect(plan.urgent_override_zones).toEqual([]);
    expect(plan.deferred_zones).toEqual([]);
  });

  it("secondary trucks take at most 2 urgent bins per zone, highest priority first; the rest wait with a decision", async () => {
    const bins = [...heavyLashkar(), ...urgentBins("morar", 4)]; // morar is not due today
    const deps = fakeDeps();
    const plan = await buildPlan(input(bins), deps);

    const secondaryCall = deps.optimizeCalls.find((c) => c.vehicles[0]!.kind === "secondary_autotipper")!;
    expect(secondaryCall.stops).toHaveLength(2);
    const sent = new Set(secondaryCall.stops.map((s) => s.bin_id));
    const priorities = (ids: string[]) => ids.map((id) => bins.find((b) => b.bin_id === id)!.priority);
    const waitingIds = plan.waiting.map((w) => w.bin_id);
    expect(waitingIds).toHaveLength(2);
    expect(Math.min(...priorities([...sent] as string[]))).toBeGreaterThanOrEqual(Math.max(...priorities(waitingIds)));
    for (const id of waitingIds) expect(decisionsMention(plan, `Bin ${id} waits`)).toBe(true);
    expect(plan.urgent_override_zones).toEqual([]); // not due: no primary run (invariant 2)
    expect(plan.routes.filter((r) => r.truck_kind === "primary_compactor").every((r) => !r.stops.some((s) => waitingIds.includes(s.bin_id!)))).toBe(true);
  });

  it("the cap of 2 applies per zone, not in total", async () => {
    const bins = [...heavyLashkar(), ...urgentBins("morar", 2), bin("lashkar", { bin_id: "L-U", fill_pct: 99 })];
    const plan = await buildPlan(input(bins), fakeDeps());
    expect(plan.waiting).toEqual([]);
    // lashkar's urgent bin is in the primary run; morar's two go to secondary
    expect(plan.routes.find((r) => r.truck_kind === "secondary_autotipper")!.stops).toHaveLength(2);
  });
});
