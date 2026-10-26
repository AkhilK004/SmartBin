import express from "express";
import type { MessageBus, StateStore } from "./adapters/types.js";
import { parseIngest } from "./http/ingest.js";
import type { Pipeline } from "./pipeline.js";
import { settingsPatchSchema, type SettingsStore } from "./settings.js";

export interface AppContext {
  bus: MessageBus;
  store: StateStore;
  settings: SettingsStore;
  pipeline: Pipeline;
  sim: { speed: number };
  clock?: () => Date;
  fetchImpl?: typeof fetch;
}

/** Same payload as the Socket.io `state:init` event (shared/schemas.md). */
export function buildState(ctx: AppContext) {
  return {
    bins: ctx.store.getBins().map((b) => ctx.pipeline.enrich(b)),
    zones: ctx.store.getZones(),
    trucks: ctx.store.getTrucks(),
    sites: ctx.store.getSites(),
    plan: null,
    savings: null,
    alerts: ctx.store.getAlerts(),
    settings: ctx.settings.get(),
    sim: { speed: ctx.sim.speed, now: (ctx.clock?.() ?? new Date()).toISOString() },
  };
}

export function buildApp(ctx: AppContext) {
  const app = express();
  // SNS posts JSON with Content-Type text/plain
  app.use(express.json({ type: ["application/json", "text/plain"] }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/state", (_req, res) => {
    res.json(buildState(ctx));
  });

  app.get("/settings", (_req, res) => {
    res.json(ctx.settings.get());
  });

  app.put("/settings", (req, res) => {
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const problem = ctx.settings.update(parsed.data);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    res.json(ctx.settings.get());
  });

  app.post("/ingest/readings", async (req, res) => {
    const result = await parseIngest(req.body, ctx.fetchImpl);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    if (result.kind === "confirmed" || result.kind === "ignored") {
      res.status(200).json({ status: result.kind });
      return;
    }
    const unknown = [...new Set(result.readings.map((r) => r.bin_id))].filter((id) => !ctx.store.getBin(id));
    if (unknown.length > 0) {
      res.status(422).json({ error: "unknown bin_id", bin_ids: unknown });
      return;
    }
    for (const r of result.readings) await ctx.bus.publish(r);
    res.status(202).json({ accepted: result.readings.length });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number }).status === 400 ? 400 : 500;
    res.status(status).json({ error: status === 400 ? "invalid JSON body" : "internal error" });
  });

  return app;
}
