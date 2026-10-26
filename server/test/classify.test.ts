import { describe, expect, it } from "vitest";
import { deriveBin, hoursLeft } from "../src/domain/classify.js";
import { overflowRisk, priorityScore } from "../src/domain/priority.js";
import { defaultSettings } from "../src/settings.js";
import type { BinBase, Zone } from "../src/types.js";

// now = 2026-10-26 15:30 IST. Next collection after today = 2026-10-28 06:00 IST -> 38.5 h left.
const NOW = new Date("2026-10-26T10:00:00Z");
const HOURS_LEFT = 38.5;

const zone: Zone = {
  zone_id: "lashkar",
  name: "Lashkar",
  polygon: [],
  fill_rate_pct_per_day: 30,
  days_to_85: 2.5,
  interval_days: 2,
  interval_label: "every_2_days",
  last_collection_date: "2026-10-24",
  next_collection_date: "2026-10-26",
  calendar: ["2026-10-26", "2026-10-28", "2026-10-30"],
};

// slow rate keeps hours_to_full far above hours_left, so only the fill thresholds matter
const bin = (over: Partial<BinBase> = {}): BinBase => ({
  bin_id: "B-X",
  zone_id: "lashkar",
  location_type: "market",
  lat: 26.18,
  lng: 78.15,
  fill_pct: 50,
  fill_rate_pct_per_hour: 0.1,
  battery: 90,
  temp_c: 30,
  gas_ppm: 100,
  complaint: false,
  status: "online",
  last_seen: NOW.toISOString(),
  last_emptied: "2026-10-25T10:00:00Z",
  ...over,
});

const derive = (over: Partial<BinBase> = {}, settings = defaultSettings()) =>
  deriveBin(bin(over), zone, settings, NOW);

describe("hoursLeft", () => {
  it("on a due day counts to the collection after today", () => {
    expect(hoursLeft(zone, NOW)).toBeCloseTo(HOURS_LEFT, 5);
  });
});

describe("classification boundaries (CLAUDE.md §4)", () => {
  it.each([
    [39.9, "skip"],
    [40, "visit_if_nearby"],
    [85, "visit_if_nearby"],
    [85.1, "must_visit"],
  ])("fill %s -> %s", (fill_pct, expected) => {
    expect(derive({ fill_pct }).bin_class).toBe(expected);
  });

  it("urgent at 95, not at 94.9", () => {
    expect(derive({ fill_pct: 95 }).urgent).toBe(true);
    expect(derive({ fill_pct: 94.9 }).urgent).toBe(false);
  });

  it("standard 88% bin is must-visit but not urgent", () => {
    const b = derive({ fill_pct: 88 });
    expect(b.bin_class).toBe("must_visit");
    expect(b.urgent).toBe(false);
  });
});

describe("hazard triggers", () => {
  it("gas above 400 ppm, not at 400", () => {
    expect(derive({ gas_ppm: 401 }).hazard).toBe(true);
    expect(derive({ gas_ppm: 400 }).hazard).toBe(false);
  });

  it("temperature above 55 C, not at 55", () => {
    expect(derive({ temp_c: 55.1 }).hazard).toBe(true);
    expect(derive({ temp_c: 55 }).hazard).toBe(false);
  });

  it("citizen complaint", () => {
    expect(derive({ complaint: true }).hazard).toBe(true);
  });

  it("hazard makes a nearly empty bin must-visit and urgent", () => {
    const b = derive({ fill_pct: 5, gas_ppm: 450 });
    expect(b.bin_class).toBe("must_visit");
    expect(b.urgent).toBe(true);
  });
});

describe("predicted overflow", () => {
  it("hours_to_full below hours_left makes the bin must-visit and urgent", () => {
    // fill 70 at 1 %/h -> 30 h to full < 38.5 h left
    const b = derive({ fill_pct: 70, fill_rate_pct_per_hour: 1 });
    expect(b.predicted_overflow).toBe(true);
    expect(b.bin_class).toBe("must_visit");
    expect(b.urgent).toBe(true);
  });

  it("40 h to full is not predicted to overflow", () => {
    const b = derive({ fill_pct: 60, fill_rate_pct_per_hour: 1 });
    expect(b.predicted_overflow).toBe(false);
    expect(b.bin_class).toBe("visit_if_nearby");
  });

  it("a low bin that will overflow before the next run is must-visit", () => {
    const b = derive({ fill_pct: 30, fill_rate_pct_per_hour: 3 });
    expect(b.predicted_overflow).toBe(true);
    expect(b.bin_class).toBe("must_visit");
  });
});

describe("colours", () => {
  it.each([
    [{ fill_pct: 39.9 }, "green"],
    [{ fill_pct: 40 }, "amber"],
    [{ fill_pct: 85 }, "amber"],
    [{ fill_pct: 85.1 }, "red"],
    [{ fill_pct: 50, gas_ppm: 500 }, "purple"],
    [{ fill_pct: 90, status: "offline" as const, gas_ppm: 500 }, "grey"],
  ])("%j -> %s", (over, color) => {
    expect(derive(over).color).toBe(color);
  });
});

describe("overflow risk and priority", () => {
  it("risk = clamp(100 * (1 - hours_to_full / hours_left))", () => {
    expect(overflowRisk(0, 40)).toBe(100);
    expect(overflowRisk(20, 40)).toBe(50);
    expect(overflowRisk(40, 40)).toBe(0);
    expect(overflowRisk(80, 40)).toBe(0);
  });

  it("priority = 0.5 fill + 0.3 risk + 0.2 location", () => {
    const s = defaultSettings();
    // market weight 100, risk 0 at slow rate: 0.5*60 + 0 + 0.2*100
    expect(derive({ fill_pct: 60 }).priority).toBe(50);
    expect(priorityScore(80, 50, "hospital", s.priority_weights)).toBeCloseTo(0.5 * 80 + 0.3 * 50 + 0.2 * 90);
  });

  it("changing weights changes priority", () => {
    const s = defaultSettings();
    const before = derive({ fill_pct: 60, location_type: "park" }, s).priority;
    s.priority_weights = { fill: 0.1, overflow_risk: 0.1, location: 0.8 };
    const after = derive({ fill_pct: 60, location_type: "park" }, s).priority;
    expect(after).not.toBe(before);
    expect(after).toBeCloseTo(0.1 * 60 + 0.8 * 30);
  });

  it("priority stays within 0-100", () => {
    const b = derive({ fill_pct: 100, fill_rate_pct_per_hour: 5, location_type: "market" });
    expect(b.priority).toBeLessThanOrEqual(100);
    expect(b.priority).toBeGreaterThanOrEqual(0);
  });
});

describe("runtime thresholds", () => {
  it("a changed skip threshold moves the class boundary", () => {
    const s = defaultSettings();
    s.thresholds.skip_below_pct = 60;
    expect(derive({ fill_pct: 50 }, s).bin_class).toBe("skip");
    expect(derive({ fill_pct: 50 }).bin_class).toBe("visit_if_nearby");
  });
});
