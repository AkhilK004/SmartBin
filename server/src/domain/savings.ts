// Savings against the fixed-route baseline (CLAUDE.md section 4). Pure functions, no I/O.

import { config } from "../config.js";
import type { LedgerDay, Metric, Plan, Savings } from "../types.js";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OverflowCounts {
  by_date: Record<string, Metric>;
  total: Metric;
}

/**
 * One plan date's contribution, or null when the plan cannot be compared:
 * no baseline, or an optimizer error (the optimized side would be incomplete).
 */
export function daySavings(plan: Plan): LedgerDay | null {
  if (!plan.baseline || plan.error) return null;
  const binStops = (r: Plan["routes"][number]) => r.stops.filter((s) => s.type === "bin").length;
  const km = plan.routes.reduce((n, r) => n + r.distance_m, 0) / 1000;
  const fuel = plan.routes.reduce((n, r) => n + (r.distance_m / 1000) * config.fuelLPerKm[r.truck_kind], 0);
  const baseKm = plan.baseline.distance_m / 1000;
  return {
    stops: { baseline: plan.baseline.stops, optimized: plan.routes.reduce((n, r) => n + binStops(r), 0) },
    km: { baseline: round1(baseKm), optimized: round1(km) },
    // the fixed baseline runs primary compactors only
    fuel_l: { baseline: round2(baseKm * config.fuelLPerKm.primary_compactor), optimized: round2(fuel) },
  };
}

const sum = (days: LedgerDay[], pick: (d: LedgerDay) => Metric): Metric => ({
  baseline: days.reduce((n, d) => n + pick(d).baseline, 0),
  optimized: days.reduce((n, d) => n + pick(d).optimized, 0),
});

/** The current savings: the latest plan date, plus running totals over every recorded date. */
export function buildSavings(ledger: Record<string, LedgerDay>, overflows: OverflowCounts): Savings | null {
  const dates = Object.keys(ledger).sort();
  const date = dates.at(-1);
  if (!date) return null;
  const day = ledger[date]!;
  const all = dates.map((d) => ledger[d]!);
  const zero: Metric = { baseline: 0, optimized: 0 };
  const r1 = (m: Metric): Metric => ({ baseline: round1(m.baseline), optimized: round1(m.optimized) });
  const r2 = (m: Metric): Metric => ({ baseline: round2(m.baseline), optimized: round2(m.optimized) });
  return {
    date,
    stops: day.stops,
    km: day.km,
    fuel_l: day.fuel_l,
    overflows_missed: overflows.by_date[date] ?? zero,
    fuel_is_estimate: true,
    simulated: true,
    cumulative: {
      stops: sum(all, (d) => d.stops),
      km: r1(sum(all, (d) => d.km)),
      fuel_l: r2(sum(all, (d) => d.fuel_l)),
      // overflows are counted every day, including days without a plan
      overflows_missed: overflows.total,
    },
  };
}
