import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { fakeDeps } from "./dispatch.helpers.js";
import { listen, makeWorld } from "./helpers.js";

let world: ReturnType<typeof makeWorld>;
let client: Socket | undefined;
afterEach(async () => {
  client?.close();
  client = undefined;
  await world.socket.close();
  world.server.close();
});

const post = (base: string, path: string) => fetch(`${base}${path}`, { method: "POST" });
const once = <T>(s: Socket, event: string) => new Promise<T>((res) => s.once(event, res));

describe("POST /jobs/daily", () => {
  it("builds, stores and publishes the plan", async () => {
    world = makeWorld({ planDeps: fakeDeps() });
    const base = await listen(world.server);
    client = connect(base);
    await once(client, "state:init");
    const planEvent = once<{ date: string }>(client, "plan:update");
    const routesEvent = once<unknown[]>(client, "routes:update");

    const res = await post(base, "/jobs/daily");
    expect(res.status).toBe(200);
    const plan = (await res.json()) as { date: string; due_zones: string[]; decisions: string[]; error: null };
    expect(plan.date).toBe("2026-10-26");
    expect(plan.due_zones.length).toBeGreaterThanOrEqual(1);
    expect(plan.decisions.length).toBeGreaterThan(0);
    expect(plan.error).toBeNull();

    expect((await planEvent).date).toBe("2026-10-26");
    expect(Array.isArray(await routesEvent)).toBe(true);
    expect(world.store.getPlan()!.date).toBe("2026-10-26");

    const state = (await (await fetch(`${base}/state`)).json()) as { plan: { date: string } };
    expect(state.plan.date).toBe("2026-10-26");
  });

  it("is repeatable on the same day and replaces the plan", async () => {
    world = makeWorld({ planDeps: fakeDeps() });
    const base = await listen(world.server);
    const a = (await (await post(base, "/jobs/daily")).json()) as { due_zones: string[] };
    const b = (await (await post(base, "/jobs/daily")).json()) as { due_zones: string[] };
    expect(b.due_zones).toEqual(a.due_zones);
  });

  it("returns 502 with the plan and its error when the optimizer fails", async () => {
    world = makeWorld({ planDeps: fakeDeps({ failOptimize: "optimizer unreachable" }) });
    const base = await listen(world.server);
    const res = await post(base, "/jobs/daily");
    expect(res.status).toBe(502);
    const plan = (await res.json()) as { error: string; routes: unknown[] };
    expect(plan.error).toMatch(/optimizer unreachable/);
    expect(plan.routes).toEqual([]);
  });
});

describe("POST /jobs/frequency", () => {
  it("returns zones with calendars and keeps the seed rate without history", async () => {
    world = makeWorld();
    const base = await listen(world.server);
    const before = world.store.getZones().map((z) => z.fill_rate_pct_per_day);
    const res = await post(base, "/jobs/frequency");
    expect(res.status).toBe(200);
    const zones = (await res.json()) as { fill_rate_pct_per_day: number; calendar: string[] }[];
    expect(zones).toHaveLength(6);
    expect(zones.map((z) => z.fill_rate_pct_per_day)).toEqual(before);
    expect(zones.every((z) => z.calendar.length > 0)).toBe(true);
  });
});
