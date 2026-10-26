import type { BinColor, LocationType, TruckKind, TruckStatus, ZoneId } from "./types";

export const COLOR_VAR: Record<BinColor, string> = {
  green: "var(--bin-green)",
  amber: "var(--bin-amber)",
  red: "var(--bin-red)",
  purple: "var(--bin-purple)",
  grey: "var(--bin-grey)",
};

// MapLibre cannot read CSS variables, so the map uses these. Keep them equal to --bin-* in index.css.
export const COLOR_HEX: Record<BinColor, string> = {
  green: "#3fb97f",
  amber: "#e0a43c",
  red: "#e5566f",
  purple: "#a56bd8",
  grey: "#6b6e75",
};

export const COLOR_LABEL: Record<BinColor, string> = {
  green: "Under 40%",
  amber: "40 to 85%",
  red: "Over 85%",
  purple: "Hazard",
  grey: "Offline",
};

export const CLASS_LABEL = {
  must_visit: "Must visit",
  visit_if_nearby: "Visit if nearby",
  skip: "Skip",
} as const;

export const LOCATION_LABEL: Record<LocationType, string> = {
  market: "Market",
  hospital: "Hospital",
  bus_stand: "Bus stand",
  school: "School",
  commercial: "Commercial",
  residential: "Residential",
  park: "Park",
};

export const KIND_LABEL: Record<TruckKind, string> = {
  primary_compactor: "Primary compactor",
  secondary_autotipper: "Secondary auto-tipper",
};

export const STATUS_LABEL: Record<TruckStatus, string> = {
  idle: "Idle at depot",
  driving: "Driving",
  servicing: "Servicing a bin",
  to_dump_yard: "To dump yard",
  unloading: "Unloading",
  returning: "Returning to depot",
};

export const INTERVAL_LABEL = {
  daily: "Daily",
  every_2_days: "Every 2 days",
  every_3_days: "Every 3 days",
  twice_a_week: "Twice a week",
} as const;

const TZ = "Asia/Kolkata";

export const fmt = {
  int: (n: number) => Math.round(n).toLocaleString("en-IN"),
  dec: (n: number, d = 1) => n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }),
  pct: (n: number) => `${Math.round(n)}%`,
  km: (m: number) =>
    `${(m / 1000).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`,
  duration: (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
  },
  time: (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }),
  dateTime: (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: TZ,
    }),
  /** "2026-10-27" to "Tue, 27 Oct" */
  day: (ymd: string) =>
    new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }),
  /** Local Gwalior date (YYYY-MM-DD) of an ISO instant. */
  localDate: (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }),
};

export function zoneName(zones: { zone_id: ZoneId; name: string }[], id: ZoneId): string {
  return zones.find((z) => z.zone_id === id)?.name ?? id;
}

/** Reduction from baseline to optimized as a percentage of baseline. null when the baseline is zero. */
export function reduction(baseline: number, optimized: number): number | null {
  if (baseline <= 0) return null;
  return ((baseline - optimized) / baseline) * 100;
}
