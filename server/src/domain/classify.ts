import { addDays, collectionStart, localDate } from "../time.js";
import type { Settings } from "../settings.js";
import type { Bin, BinBase, BinClass, BinColor, Zone } from "../types.js";
import { overflowRisk, priorityScore } from "./priority.js";

type Thresholds = Settings["thresholds"];

/** Hazard flag (CLAUDE.md §4): gas, temperature, or a citizen complaint. */
export function isHazard(bin: Pick<BinBase, "gas_ppm" | "temp_c" | "complaint">, t: Thresholds): boolean {
  return bin.gas_ppm > t.gas_ppm_hazard || bin.temp_c > t.temp_c_hazard || bin.complaint;
}

/**
 * Hours until the zone's next collection: the first calendar date after today.
 * On a due day that is the collection after today's, because today's run
 * collects the bin anyway (CLAUDE.md §4: "overflow before the zone's next collection").
 */
export function hoursLeft(zone: Zone, now: Date): number {
  const today = localDate(now);
  const next = zone.calendar.find((d) => d > today) ?? addDays(today, Math.ceil(zone.interval_days));
  return (collectionStart(next).getTime() - now.getTime()) / 3_600_000;
}

export function hoursToFull(fillPct: number, ratePctPerHour: number): number {
  return (100 - fillPct) / Math.max(ratePctPerHour, 0.01);
}

export function binColor(bin: BinBase, hazard: boolean, t: Thresholds): BinColor {
  if (bin.status === "offline") return "grey";
  if (hazard) return "purple";
  if (bin.fill_pct > t.must_visit_above_pct) return "red";
  if (bin.fill_pct >= t.skip_below_pct) return "amber";
  return "green";
}

export function binClass(
  fillPct: number,
  hazard: boolean,
  predictedOverflow: boolean,
  t: Thresholds,
): BinClass {
  if (fillPct > t.must_visit_above_pct || predictedOverflow || hazard) return "must_visit";
  if (fillPct < t.skip_below_pct) return "skip";
  return "visit_if_nearby";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Adds the server-derived fields (shared/schemas.md Bin). Decisions use unrounded values. */
export function deriveBin(bin: BinBase, zone: Zone, settings: Settings, now: Date): Bin {
  const t = settings.thresholds;
  const hazard = isHazard(bin, t);
  const htf = hoursToFull(bin.fill_pct, bin.fill_rate_pct_per_hour);
  const left = hoursLeft(zone, now);
  const predicted = htf < left;
  const risk = overflowRisk(htf, left);
  return {
    ...bin,
    hazard,
    urgent: bin.fill_pct >= t.urgent_at_pct || predicted || hazard,
    predicted_overflow: predicted,
    hours_to_full: round2(htf),
    overflow_risk: round2(risk),
    priority: round2(priorityScore(bin.fill_pct, risk, bin.location_type, settings.priority_weights)),
    bin_class: binClass(bin.fill_pct, hazard, predicted, t),
    color: binColor(bin, hazard, t),
  };
}
