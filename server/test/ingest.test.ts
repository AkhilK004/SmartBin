import { afterEach, describe, expect, it } from "vitest";
import { listen, makeWorld, reading, tick } from "./helpers.js";

let world: ReturnType<typeof makeWorld>;
afterEach(async () => {
  await world.socket.close();
  world.server.close();
});

const post = (base: string, body: unknown, contentType = "application/json") =>
  fetch(`${base}/ingest/readings`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /ingest/readings", () => {
  it("raw reading and SNS envelope update the same bin", async () => {
    world = makeWorld();
    const base = await listen(world.server);

    const raw = await post(base, reading("B-001", { fill_pct: 71 }));
    expect(raw.status).toBe(202);
    await tick();
    expect(world.store.getBin("B-001")!.fill_pct).toBe(71);

    const envelope = {
      Type: "Notification",
      MessageId: "x",
      Message: JSON.stringify(reading("B-001", { fill_pct: 83 })),
    };
    const sns = await post(base, envelope, "text/plain");
    expect(sns.status).toBe(202);
    await tick();
    expect(world.store.getBin("B-001")!.fill_pct).toBe(83);
    expect(world.history.readings("B-001")).toHaveLength(2);
  });

  it("accepts an array of readings", async () => {
    world = makeWorld();
    const base = await listen(world.server);
    const res = await post(base, [reading("B-001", { fill_pct: 10 }), reading("B-002", { fill_pct: 20 })]);
    expect(res.status).toBe(202);
    await tick();
    expect(world.store.getBin("B-002")!.fill_pct).toBe(20);
  });

  it("returns 400 for an invalid payload", async () => {
    world = makeWorld();
    const base = await listen(world.server);
    for (const bad of [{ bin_id: "B-001" }, reading("B-001", { fill_pct: 120 }), "not json"]) {
      const res = await post(base, bad);
      expect(res.status).toBe(400);
    }
  });

  it("returns 422 for an unknown bin", async () => {
    world = makeWorld();
    const base = await listen(world.server);
    const res = await post(base, reading("B-999"));
    expect(res.status).toBe(422);
  });

  it("confirms an SNS subscription only for SNS hosts", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (u: URL) => {
      calls.push(String(u));
      return new Response("ok");
    }) as unknown as typeof fetch;
    world = makeWorld({ fetchImpl: fakeFetch });
    const base = await listen(world.server);

    const good = await post(base, {
      Type: "SubscriptionConfirmation",
      SubscribeURL: "https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=t",
    });
    expect(good.status).toBe(200);
    expect(calls).toHaveLength(1);

    const evil = await post(base, { Type: "SubscriptionConfirmation", SubscribeURL: "https://evil.example.com/x" });
    expect(evil.status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});
