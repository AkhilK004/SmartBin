import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { localDate } from "../src/time.js";
import type { Plan } from "../src/types.js";
import { listen, NOW, tick } from "./helpers.js";
import { runFor, simWorld } from "./sim.helpers.js";

const H = 3600;
let world: ReturnType<typeof simWorld>;
let client: Socket | undefined;
afterEach(async () => {
  client?.close();
  client = undefined;
  world?.engine.stop();
  await world?.socket.close();
  world?.server.close();
});

describe("simulated day (Phase 6 exit check)", () => {
  it("jobs fire on simulated time, trucks run the plan, bins are emptied, zones are marked collected", async () => {
    world = simWorld(); // starts 2026-10-26 15:30 IST
    let plan: Plan | undefined;
    world.pipeline.events.on("plan:new", (p: Plan) => (plan = p));

    // to 00:30 IST on the 27th: 9 h
    await runFor(world.engine, 9 * H + 60);
    expect(world.jobs).toContain("/jobs/frequency");
    expect(world.jobs).toContain("/jobs/daily");
    await tick(50);
    expect(plan?.date).toBe("2026-10-27");

    const routed = [...new Set(plan!.routes.flatMap((r) => r.stops.filter((s) => s.type === "bin").map((s) => s.bin_id!)))];
    expect(routed.length).toBeGreaterThan(0);
    const primaryZones = plan!.due_zones.filter((z) => !plan!.deferred_zones.some((d) => d.zone_id === z));

    // trucks wait for the 06:00 start, then drive
    await runFor(world.engine, 5 * H);
    expect(world.store.getTrucks().every((t) => t.status === "idle")).toBe(true);
    await runFor(world.engine, 30 * 60);
    expect(world.store.getTrucks().some((t) => t.status !== "idle")).toBe(true);

    // a whole shift later everything is done
    await runFor(world.engine, 9 * H);
    await tick(50);
    for (const id of routed) {
      expect(world.history.emptyings(id).length, id).toBeGreaterThanOrEqual(1);
      expect(world.store.getBin(id)!.last_emptied > "2026-10-27T00:30:00Z", id).toBe(true);
    }
    for (const t of world.store.getTrucks()) {
      expect(t.load_kg).toBeLessThanOrEqual(t.capacity_kg);
      expect(t.status).toBe("idle");
    }
    for (const z of world.store.getZones().filter((z) => primaryZones.includes(z.zone_id))) {
      expect(z.last_collection_date).toBe("2026-10-27");
      expect(z.calendar[0]! > "2026-10-27" || z.calendar[0] === localDate(world.clock.now())).toBe(true);
    }
  }, 60_000);

  it("a full truck makes dump-yard visits and never exceeds its capacity", async () => {
    world = simWorld({ start: new Date("2026-10-26T20:00:00Z") }); // 01:30 IST on the 27th
    // shrink every primary truck so a run needs several loads
    world.store.setTrucks(world.store.getTrucks().map((t) => (t.kind === "primary_compactor" ? { ...t, capacity_kg: 300 } : t)));
    const e2 = new (world.engine.constructor as typeof import("../src/sim/engine.js").SimEngine)({
      store: world.store,
      history: world.history,
      pipeline: world.pipeline,
      clock: world.clock,
      sim: world.ctx.sim,
      publish: async (rs) => {
        for (const r of rs) await world.bus.publish(r);
      },
      callJob: async () => {},
    });
    world.ctx.simControl = e2;
    // force a zone that is certainly due and heavy
    const zone = world.store.getZones()[0]!;
    world.store.setZones(world.store.getZones().map((z) => ({ ...z, calendar: [localDate(world.clock.now()), ...z.calendar.slice(1)] })));
    for (const b of world.store.getBins().filter((b) => b.zone_id === zone.zone_id)) {
      await world.pipeline.patchBin(b.bin_id, { fill_pct: 70, fill_rate_pct_per_hour: 0.1 });
    }
    const { runDailyJob } = await import("../src/jobs.js");
    const plan = await runDailyJob(world.ctx);
    const primary = plan.routes.filter((r) => r.truck_kind === "primary_compactor");
    expect(primary.some((r) => r.stops.some((s) => s.type === "dump_yard"))).toBe(true);

    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      await runFor(e2, 1800);
      for (const t of world.store.getTrucks()) {
        expect(t.load_kg).toBeLessThanOrEqual(t.capacity_kg);
        seen.add(t.status);
      }
    }
    expect(seen.has("unloading")).toBe(true);
    expect(world.store.getTrucks().every((t) => t.status === "idle")).toBe(true);
    e2.stop();
  }, 120_000);
});

describe("overflows missed", () => {
  it("counts a bin that fills up before any truck comes, for both schedules", async () => {
    world = simWorld();
    const bin = world.store.getBins().find((b) => b.zone_id === "lashkar")!;
    world.engine.setBin(bin.bin_id, { fill_pct: 99.5 });
    await runFor(world.engine, 2 * H);
    const o = world.engine.status().overflows_missed;
    expect(o.total.optimized).toBeGreaterThanOrEqual(1);
    expect(o.by_date[localDate(NOW)]?.optimized ?? o.by_date[localDate(world.clock.now())]?.optimized).toBeGreaterThanOrEqual(1);
  });

  it("with no trucks running, the daily baseline replay overflows strictly less than the real schedule", async () => {
    world = simWorld({ jobs: false });
    const zone = world.store.getZones()[0]!;
    world.store.setZones(world.store.getZones().map((z) => ({ ...z, last_collection_date: "2026-10-25", interval_days: 1, interval_label: "daily" as const, fill_rate_pct_per_day: 80 })));
    for (const b of world.store.getBins().filter((b) => b.zone_id === zone.zone_id)) {
      world.engine.setBin(b.bin_id, { fill_pct: 60 });
    }
    // lastBaseline was captured at construction; a daily zone is emptied at 06:00 every day
    await runFor(world.engine, 3 * 24 * H, 1800);
    const total = world.engine.status().overflows_missed.total;
    expect(total.baseline).toBeGreaterThan(0); // fast markets still fill before 06:00
    expect(total.optimized).toBeGreaterThan(total.baseline);
  }, 60_000);
});

describe("manual controls", () => {
  it("setBin changes the bin at once: fill, gas, complaint, offline", async () => {
    world = simWorld();
    const id = world.store.getBins()[0]!.bin_id;
    const b = world.engine.setBin(id, { fill_pct: 97, gas_ppm: 480, complaint: true })!;
    expect(b.complaint).toBe(true);
    await tick(50);
    const after = world.store.getBin(id)!;
    expect(after.fill_pct).toBe(97);
    expect(after.gas_ppm).toBeGreaterThan(400);
    expect(world.pipeline.enrich(after).color).toBe("purple");

    world.engine.setBin(id, { offline: true });
    expect(world.store.getBin(id)!.status).toBe("offline");
    world.engine.setBin(id, { offline: false });
    await tick(50);
    expect(world.store.getBin(id)!.status).toBe("online");
    expect(world.engine.setBin("B-999", { fill_pct: 10 })).toBeUndefined();
  });

  it("setSpeed accepts only 1, 60 and 600", () => {
    world = simWorld();
    expect(world.engine.setSpeed(60)).toBe(true);
    expect(world.ctx.sim.speed).toBe(60);
    expect(world.engine.setSpeed(7)).toBe(false);
    expect(world.ctx.sim.speed).toBe(60);
  });
});

describe("/sim HTTP and sockets", () => {
  const post = (base: string, path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST /sim/bin, /sim/speed and GET /sim", async () => {
    world = simWorld();
    const base = await listen(world.server);
    const id = world.store.getBins()[0]!.bin_id;

    const ok = await post(base, "/sim/bin", { bin_id: id, fill_pct: 91 });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { fill_pct: number }).fill_pct).toBe(91);
    expect((await post(base, "/sim/bin", { bin_id: "B-999", fill_pct: 5 })).status).toBe(404);
    expect((await post(base, "/sim/bin", { bin_id: id })).status).toBe(400);
    expect((await post(base, "/sim/bin", { bin_id: id, fill_pct: 500 })).status).toBe(400);
    expect((await post(base, "/sim/bin", { bin_id: id, nope: 1 })).status).toBe(400);

    expect((await post(base, "/sim/speed", { speed: 60 })).status).toBe(200);
    expect((await post(base, "/sim/speed", { speed: 5 })).status).toBe(400);
    const status = (await (await fetch(`${base}/sim`)).json()) as { speed: number; overflows_missed: unknown };
    expect(status.speed).toBe(60);
    expect(status.overflows_missed).toBeDefined();
  });

  it("answers 503 when the simulator is off", async () => {
    world = simWorld();
    world.ctx.simControl = undefined;
    const base = await listen(world.server);
    expect((await fetch(`${base}/sim`)).status).toBe(503);
    expect((await post(base, "/sim/speed", { speed: 60 })).status).toBe(503);
  });

  it("emits trucks:update and sim:update every tick", async () => {
    world = simWorld();
    const base = await listen(world.server);
    client = connect(base);
    await new Promise((r) => client!.once("state:init", r));
    const trucks = new Promise<unknown[]>((r) => client!.once("trucks:update", r));
    const sim = new Promise<{ speed: number; now: string }>((r) => client!.once("sim:update", r));
    await world.engine.advance(1);
    expect((await trucks).length).toBe(5);
    expect((await sim).speed).toBe(1);
  });
});
