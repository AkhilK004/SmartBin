import { config } from "../config.js";
import type { Alert, AlertType, BinBase } from "../types.js";
import type { Settings } from "../settings.js";
import { isHazard } from "./classify.js";

function conditions(bin: BinBase, s: Settings): Record<AlertType, string | null> {
  const t = s.thresholds;
  const hazardWhy = [
    bin.gas_ppm > t.gas_ppm_hazard && `gas ${bin.gas_ppm} ppm > ${t.gas_ppm_hazard} ppm`,
    bin.temp_c > t.temp_c_hazard && `temperature ${bin.temp_c} °C > ${t.temp_c_hazard} °C`,
    bin.complaint && "citizen complaint",
  ].filter(Boolean);
  return {
    overflow: bin.fill_pct >= config.thresholds.overflowPct ? `${bin.bin_id} overflowing (${bin.fill_pct}% full)` : null,
    hazard: isHazard(bin, t) ? `${bin.bin_id} hazard: ${hazardWhy.join(", ")}` : null,
    low_battery:
      bin.battery < config.alerts.lowBatteryPct
        ? `${bin.bin_id} battery ${bin.battery}% < ${config.alerts.lowBatteryPct}%`
        : null,
    offline: bin.status === "offline" ? `${bin.bin_id} offline (last seen ${bin.last_seen})` : null,
  };
}

type Entry = [AlertType, string | null];

/** Emits an alert once when a condition becomes active, not on every reading. */
export class AlertTracker {
  private active = new Map<string, Set<AlertType>>();
  private counter = 0;

  /** Mark current conditions as already alerted (after restart) without emitting. */
  prime(bins: BinBase[], existing: Alert[], settings: Settings): void {
    for (const a of existing) this.counter = Math.max(this.counter, Number(a.alert_id.slice(2)) || 0);
    for (const bin of bins) {
      const on = new Set<AlertType>();
      for (const [type, msg] of Object.entries(conditions(bin, settings)) as Entry[]) {
        if (msg) on.add(type);
      }
      this.active.set(bin.bin_id, on);
    }
  }

  evaluate(bin: BinBase, now: Date, settings: Settings): Alert[] {
    const before = this.active.get(bin.bin_id) ?? new Set<AlertType>();
    const after = new Set<AlertType>();
    const fresh: Alert[] = [];
    for (const [type, msg] of Object.entries(conditions(bin, settings)) as Entry[]) {
      if (!msg) continue;
      after.add(type);
      if (!before.has(type)) {
        this.counter += 1;
        fresh.push({
          alert_id: `A-${String(this.counter).padStart(6, "0")}`,
          type,
          bin_id: bin.bin_id,
          message: msg,
          timestamp: now.toISOString(),
        });
      }
    }
    this.active.set(bin.bin_id, after);
    return fresh;
  }
}
