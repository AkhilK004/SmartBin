import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../src/settings.js";
import { listen, makeWorld } from "./helpers.js";

describe("SettingsStore", () => {
  it("normalises weights to sum 1", () => {
    const s = new SettingsStore();
    expect(s.update({ priority_weights: { fill: 5, overflow_risk: 3, location: 2 } })).toBeNull();
    const w = s.get().priority_weights;
    expect(w.fill).toBeCloseTo(0.5);
    expect(w.overflow_risk).toBeCloseTo(0.3);
    expect(w.location).toBeCloseTo(0.2);
  });

  it("a partial weight patch merges with current weights", () => {
    const s = new SettingsStore();
    s.update({ priority_weights: { fill: 0 } });
    const w = s.get().priority_weights;
    expect(w.fill).toBe(0);
    expect(w.overflow_risk + w.location).toBeCloseTo(1);
  });

  it("rejects all-zero weights and leaves state unchanged", () => {
    const s = new SettingsStore();
    const before = s.get();
    expect(s.update({ priority_weights: { fill: 0, overflow_risk: 0, location: 0 } })).toMatch(/zero/);
    expect(s.get()).toEqual(before);
  });

  it("rejects inconsistent thresholds", () => {
    const s = new SettingsStore();
    expect(s.update({ thresholds: { skip_below_pct: 90 } })).toMatch(/thresholds/);
  });
});

const put = (base: string, body: unknown) =>
  fetch(`${base}/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PUT /settings", () => {
  let world: ReturnType<typeof makeWorld>;
  afterEach(async () => {
    await world.socket.close();
    world.server.close();
  });

  it("updates settings and the derived bins follow", async () => {
    world = makeWorld();
    const base = await listen(world.server);
    const bin = world.store.getBin("B-001")!;
    world.store.upsertBin({ ...bin, fill_pct: 50, fill_rate_pct_per_hour: 0.1, gas_ppm: 100 });
    expect(world.pipeline.enrich(world.store.getBin("B-001")!).bin_class).toBe("visit_if_nearby");

    const res = await put(base, { thresholds: { skip_below_pct: 60 }, penalty_scale: 80 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { penalty_scale: number };
    expect(body.penalty_scale).toBe(80);
    expect(world.pipeline.enrich(world.store.getBin("B-001")!).bin_class).toBe("skip");
  });

  it("rejects unknown keys and bad values with 400", async () => {
    world = makeWorld();
    const base = await listen(world.server);
    expect((await put(base, { nope: 1 })).status).toBe(400);
    expect((await put(base, { penalty_scale: -5 })).status).toBe(400);
    expect((await put(base, { thresholds: { skip_below_pct: 99 } })).status).toBe(400);
  });
});
