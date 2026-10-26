import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import type { Pipeline } from "./pipeline.js";
import { buildState, type AppContext } from "./routes.js";
import type { Alert, Bin } from "./types.js";

export function attachSocket(httpServer: HttpServer, ctx: AppContext, pipeline: Pipeline) {
  const io = new Server(httpServer, { cors: { origin: true } });

  // `state:init` on every connect also covers reconnects.
  io.on("connection", (socket) => {
    socket.emit("state:init", buildState(ctx));
  });

  const changed = new Map<string, Bin>();
  pipeline.events.on("bins:changed", (bin: Bin) => changed.set(bin.bin_id, bin));
  pipeline.events.on("alert:new", (alert: Alert) => io.emit("alerts:new", alert));

  const flush = setInterval(() => {
    if (changed.size === 0) return;
    io.emit("bins:update", [...changed.values()]);
    changed.clear();
  }, config.binsFlushMs);

  return {
    io,
    close: async () => {
      clearInterval(flush);
      await io.close();
    },
  };
}
