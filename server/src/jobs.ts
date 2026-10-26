import { createOsrmClient } from "./clients/osrm.js";
import { createOptimizerClient } from "./clients/optimizer.js";
import { buildPlan, type PlanDeps } from "./domain/dispatch.js";
import { planFrequency, rollCalendars } from "./domain/frequency.js";
import type { AppContext } from "./routes.js";
import { localDate } from "./time.js";
import type { Plan, Zone } from "./types.js";

export function defaultPlanDeps(): PlanDeps {
  const optimizer = createOptimizerClient();
  const osrm = createOsrmClient();
  return {
    optimize: optimizer.optimize,
    baseline: optimizer.baseline,
    roadRoute: async (points) => {
      const r = await osrm.route(points);
      return { geometry: r.geometry, distance_source: r.distance_source };
    },
  };
}

const nowOf = (ctx: AppContext) => (ctx.clock ?? (() => new Date()))();

/** POST /jobs/frequency: zone rates from history, then intervals and calendars. */
export function runFrequencyJob(ctx: AppContext): Zone[] {
  const today = localDate(nowOf(ctx));
  const zones = planFrequency(ctx.store.getZones(), ctx.store.getBins(), ctx.history, today);
  ctx.store.setZones(zones);
  return zones;
}

/** POST /jobs/daily: roll calendars to today, build the plan, publish it. */
export async function runDailyJob(ctx: AppContext): Promise<Plan> {
  const now = nowOf(ctx);
  ctx.store.setZones(rollCalendars(ctx.store.getZones(), localDate(now)));
  const plan = await buildPlan(
    {
      now,
      bins: ctx.store.getBins().map((b) => ctx.pipeline.enrich(b)),
      zones: ctx.store.getZones(),
      trucks: ctx.store.getTrucks(),
      sites: ctx.store.getSites(),
      settings: ctx.settings.get(),
    },
    ctx.planDeps,
  );
  ctx.store.setPlan(plan);
  ctx.pipeline.events.emit("plan:new", plan);
  return plan;
}
