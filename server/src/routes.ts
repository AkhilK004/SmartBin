import express from "express";
import { config } from "./config.js";
import type { HistoryStore, MessageBus, StateStore } from "./adapters/types.js";
import type { PlanDeps } from "./domain/dispatch.js";
import { parseIngest } from "./http/ingest.js";
import { runDailyJob, runFrequencyJob } from "./jobs.js";
import type { Pipeline } from "./pipeline.js";
import { settingsPatchSchema, type SettingsStore } from "./settings.js";
import type { SimControl } from "./sim/engine.js";
import { z } from "zod";

export interface AppContext {
  bus: MessageBus;
  store: StateStore;
  history: HistoryStore;
  planDeps: PlanDeps;
  settings: SettingsStore;
  pipeline: Pipeline;
  sim: { speed: number };
  /** Present when the simulator is on (SIM != off). */
  simControl?: SimControl;
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
    plan: ctx.store.getPlan(),
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

  app.post("/jobs/frequency", (_req, res) => {
    res.json(runFrequencyJob(ctx));
  });

  app.post("/jobs/daily", async (_req, res) => {
    try {
      const plan = await runDailyJob(ctx);
      res.status(plan.error ? 502 : 200).json(plan);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const simBodySchema = z
    .object({
      bin_id: z.string().min(1),
      fill_pct: z.number().min(0).max(100).optional(),
      gas_ppm: z.number().min(0).optional(),
      temp_c: z.number().optional(),
      complaint: z.boolean().optional(),
      offline: z.boolean().optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 1, { message: "give at least one field besides bin_id" });

  app.get("/sim", (_req, res) => {
    if (!ctx.simControl) {
      res.status(503).json({ error: "simulator is off (SIM=off)" });
      return;
    }
    res.json(ctx.simControl.status());
  });

  app.post("/sim/bin", (req, res) => {
    if (!ctx.simControl) {
      res.status(503).json({ error: "simulator is off (SIM=off)" });
      return;
    }
    const parsed = simBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { bin_id, ...patch } = parsed.data;
    const bin = ctx.simControl.setBin(bin_id, patch);
    if (!bin) {
      res.status(404).json({ error: "unknown bin_id", bin_id });
      return;
    }
    res.json(bin);
  });

  app.post("/sim/speed", (req, res) => {
    if (!ctx.simControl) {
      res.status(503).json({ error: "simulator is off (SIM=off)" });
      return;
    }
    const speed = (req.body as { speed?: unknown } | undefined)?.speed;
    if (typeof speed !== "number" || !ctx.simControl.setSpeed(speed)) {
      res.status(400).json({ error: `speed must be one of ${config.simSpeeds.join(", ")}` });
      return;
    }
    res.json(ctx.simControl.status());
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
