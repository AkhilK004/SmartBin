import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { listen, makeWorld, reading } from "./helpers.js";

let world: ReturnType<typeof makeWorld>;
let client: Socket;
afterEach(async () => {
  client?.close();
  await world.socket.close();
  world.server.close();
});

const once = <T>(s: Socket, event: string) => new Promise<T>((res) => s.once(event, res));

describe("socket", () => {
  it("sends state:init on connect, then batched bins:update and alerts:new", async () => {
    world = makeWorld();
    const base = await listen(world.server);
    client = connect(base);
    const init = await once<{ bins: unknown[]; settings: { penalty_scale: number } }>(client, "state:init");
    expect(init.bins).toHaveLength(60);
    expect(init.settings.penalty_scale).toBe(60);

    const update = once<{ bin_id: string; fill_pct: number }[]>(client, "bins:update");
    const alert = once<{ type: string }>(client, "alerts:new");
    await world.bus.publish(reading("B-004", { fill_pct: 100 }));
    expect((await update)[0]).toMatchObject({ bin_id: "B-004", fill_pct: 100 });
    expect((await alert).type).toBe("overflow");
  });
});
