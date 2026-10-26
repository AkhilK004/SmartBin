import { config } from "../config.js";
import type { Settings } from "../settings.js";
import type { LocationType } from "../types.js";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** OverflowRisk = clamp(100 * (1 - hours_to_full / hours_left), 0, 100) (CLAUDE.md §4). */
export function overflowRisk(hoursToFull: number, hoursLeft: number): number {
  return clamp(100 * (1 - hoursToFull / hoursLeft), 0, 100);
}

/** Priority = w.fill * Fill% + w.overflow_risk * OverflowRisk + w.location * LocationWeight, 0-100. */
export function priorityScore(
  fillPct: number,
  risk: number,
  location: LocationType,
  w: Settings["priority_weights"],
): number {
  return w.fill * fillPct + w.overflow_risk * risk + w.location * config.locationWeight[location];
}
