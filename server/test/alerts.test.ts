import { describe, expect, it } from "vitest";
import type { Alert } from "../src/types.js";
import { NOW, makeWorld, reading, tick } from "./helpers.js";

function collect(world: ReturnType<typeof makeWorld>) {
  const alerts: Alert[] = [];
  world.pipeline.events.on("alert:new", (a: Alert) => alerts.push(a));
  return alerts;
}

describe("alerts", () => {
  it("fires hazard once, not on every reading, and again after it clears", async () => {
    const world = makeWorld();
    const alerts = collect(world);
    const hot = reading("B-001", { gas_ppm: 460 });

    await world.bus.publish(hot);
    await world.bus.publish(hot);
    await tick();
    expect(alerts.filter((a) => a.type === "hazard")).toHaveLength(1);

    await world.bus.publish(reading("B-001", { gas_ppm: 100 }));
    await world.bus.publish(hot);
    await tick();
    expect(alerts.filter((a) => a.type === "hazard")).toHaveLength(2);
    await world.socket.close();
  });

  it("fires overflow and low battery", async () => {
    const world = makeWorld();
    const alerts = collect(world);
    await world.bus.publish(reading("B-002", { fill_pct: 100, battery: 10 }));
    await tick();
    expect(alerts.map((a) => a.type).sort()).toEqual(["low_battery", "overflow"]);
    await world.socket.close();
  });

  it("marks silent bins offline once, and back online on a new reading", async () => {
    let now = NOW;
    const world = makeWorld({ clock: () => now });
    const alerts = collect(world);

    now = new Date(NOW.getTime() + 10 * 60 * 1000);
    world.pipeline.sweepOffline();
    world.pipeline.sweepOffline();
    const offline = alerts.filter((a) => a.type === "offline");
    expect(offline).toHaveLength(world.store.getBins().length);
    expect(world.store.getBin("B-001")!.status).toBe("offline");

    await world.bus.publish(reading("B-001", { timestamp: now.toISOString() }));
    await tick();
    expect(world.store.getBin("B-001")!.status).toBe("online");
    await world.socket.close();
  });
});
