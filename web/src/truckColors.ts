import type { TruckKind } from "./types";

// Primary routes use steps of the accent hue so overlapping routes stay distinguishable; secondary routes are white.
const PRIMARY = ["#4a8ad6", "#8bbaf0", "#2f64a8", "#b3d2f7"];
export const SECONDARY_COLOR = "#f2f2f3";

/** Stable colour per truck from the digits in its id (T-P1, T-P2, T-S1). */
export function truckColor(truckId: string, kind: TruckKind): string {
  if (kind === "secondary_autotipper") return SECONDARY_COLOR;
  const n = Number(truckId.match(/\d+/)?.[0] ?? 1);
  return PRIMARY[(n - 1 + PRIMARY.length) % PRIMARY.length];
}
