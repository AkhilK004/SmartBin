import { z } from "zod";
import { config } from "./config.js";

export interface Settings {
  priority_weights: { fill: number; overflow_risk: number; location: number };
  penalty_scale: number;
  thresholds: {
    skip_below_pct: number;
    must_visit_above_pct: number;
    urgent_at_pct: number;
    gas_ppm_hazard: number;
    temp_c_hazard: number;
  };
}

function normalise(w: Settings["priority_weights"]): Settings["priority_weights"] {
  const sum = w.fill + w.overflow_risk + w.location;
  return { fill: w.fill / sum, overflow_risk: w.overflow_risk / sum, location: w.location / sum };
}

export function defaultSettings(): Settings {
  const w = config.priorityWeights;
  const t = config.thresholds;
  return {
    priority_weights: normalise({ fill: w.fill, overflow_risk: w.overflowRisk, location: w.location }),
    penalty_scale: config.penaltyScale,
    thresholds: {
      skip_below_pct: t.skipBelowPct,
      must_visit_above_pct: t.mustVisitAbovePct,
      urgent_at_pct: t.urgentAtPct,
      gas_ppm_hazard: t.gasPpmHazard,
      temp_c_hazard: t.tempCHazard,
    },
  };
}

const pct = z.number().min(0).max(100);

/** PUT /settings body: any subset, unknown keys rejected (shared/schemas.md). */
export const settingsPatchSchema = z
  .object({
    priority_weights: z
      .object({ fill: z.number().min(0), overflow_risk: z.number().min(0), location: z.number().min(0) })
      .partial()
      .strict(),
    penalty_scale: z.number().positive(),
    thresholds: z
      .object({
        skip_below_pct: pct,
        must_visit_above_pct: pct,
        urgent_at_pct: pct,
        gas_ppm_hazard: z.number().min(0),
        temp_c_hazard: z.number(),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Runtime settings, editable from the dashboard (CLAUDE.md §3.10). */
export class SettingsStore {
  private current: Settings = defaultSettings();

  get(): Settings {
    return this.current;
  }

  /** Returns an error string when the merged result is invalid; state is unchanged then. */
  update(patch: SettingsPatch): string | null {
    const next: Settings = {
      priority_weights: { ...this.current.priority_weights, ...patch.priority_weights },
      penalty_scale: patch.penalty_scale ?? this.current.penalty_scale,
      thresholds: { ...this.current.thresholds, ...patch.thresholds },
    };
    const w = next.priority_weights;
    if (w.fill + w.overflow_risk + w.location <= 0) return "priority weights must not all be zero";
    const t = next.thresholds;
    if (!(t.skip_below_pct <= t.must_visit_above_pct && t.must_visit_above_pct <= t.urgent_at_pct)) {
      return "thresholds must satisfy skip_below_pct <= must_visit_above_pct <= urgent_at_pct";
    }
    next.priority_weights = normalise(w);
    this.current = next;
    return null;
  }
}
