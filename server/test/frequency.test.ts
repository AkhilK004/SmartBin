import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  fillSlopePerHour,
  initialZones,
  intervalFor,
  planFrequency,
  scheduleFor,
} from "../src/domain/frequency.js";
import { seedBins, seedZoneBases } from "../src/seed.js";
import { weekday } from "../src/time.js";
import type { SensorReading } from "../src/types.js";
import { FakeHistory, NOW } from "./helpers.js";

describe("intervalFor (days_to_85 = 75 / rate)", () => {
  it.each([
    [60, "daily", 1],
    [50.1, "daily", 1], // 1.497 days
    [50, "every_2_days", 2], // exactly 1.5 is not under 1.5
    [30.1, "every_2_days", 2], // 2.49 days
    [30, "every_3_days", 3], // exactly 2.5
    [21.5, "every_3_days", 3], // 3.488 days
    [21.4, "twice_a_week", 3.5], // 3.505 days
    [5, "twice_a_week", 3.5],
  ])("rate %s %%/day -> %s", (rate, label, days) => {
    const i = intervalFor(rate);
    expect(i.interval_label).toBe(label);
    expect(i.interval_days).toBe(days);
    expect(i.days_to_85).toBeCloseTo(75 / rate, 2);
  });

  it("guards a zero rate", () => {
    expect(intervalFor(0).interval_label).toBe("twice_a_week");
  });
});

describe("calendar", () => {
  const today = "2026-10-26"; // Monday

  it("daily lists every day for 14 days, today included", () => {
    const cal = buildCalendar(intervalFor(60), "2026-10-25", today);
    expect(cal).toHaveLength(14);
    expect(cal[0]).toBe(today);
  });

  it("every 2 days follows the grid from the last collection", () => {
    const cal = buildCalendar(intervalFor(40), "2026-10-25", today);
    expect(cal.slice(0, 3)).toEqual(["2026-10-27", "2026-10-29", "2026-10-31"]);
  });

  it("twice a week uses Monday and Thursday only", () => {
    const cal = buildCalendar(intervalFor(10), "2026-10-23", today);
    expect(cal.length).toBeGreaterThanOrEqual(4);
    for (const d of cal) expect([1, 4]).toContain(weekday(d));
    expect(cal[0]).toBe(today);
  });

  it("scheduleFor sets next_collection_date to the first calendar date", () => {
    const s = scheduleFor(40, "2026-10-25", today);
    expect(s.next_collection_date).toBe("2026-10-27");
  });

  it("first boot is staggered: some zones due today, not all", () => {
    const zones = initialZones(seedZoneBases(seedBins(60, NOW)), today);
    const due = zones.filter((z) => z.next_collection_date === today);
    expect(due.length).toBeGreaterThanOrEqual(1);
    expect(due.length).toBeLessThan(zones.length);
    for (const z of zones) expect(z.calendar.length).toBeGreaterThan(0);
  });
});

const series = (binId: string, ratePerHour: number, hours: number, startFill = 0): SensorReading[] =>
  Array.from({ length: hours + 1 }, (_, h) => ({
    bin_id: binId,
    fill_pct: Math.min(100, startFill + ratePerHour * h),
    lat: 26.2,
    lng: 78.17,
    battery: 90,
    temp_c: 30,
    gas_ppm: 100,
    timestamp: new Date(NOW.getTime() - (hours - h) * 3_600_000).toISOString(),
  }));

describe("fill slope", () => {
  const pts = (rs: SensorReading[]) => rs.map((r) => ({ t: new Date(r.timestamp).getTime(), fill: r.fill_pct }));

  it("recovers a known slope", () => {
    expect(fillSlopePerHour(pts(series("B-1", 2, 20)))).toBeCloseTo(2, 5);
  });

  it("is null when history is too short or too thin", () => {
    expect(fillSlopePerHour(pts(series("B-1", 2, 3)))).toBeNull();
    expect(fillSlopePerHour(pts(series("B-1", 2, 0)))).toBeNull();
  });

  it("is null when fill is not rising", () => {
    expect(fillSlopePerHour(pts(series("B-1", 0, 20, 30)))).toBeNull();
  });
});

describe("planFrequency", () => {
  const today = "2026-10-26";
  const bins = seedBins(60, NOW);
  const zones = initialZones(seedZoneBases(bins), today);
  const lashkarBins = bins.filter((b) => b.zone_id === "lashkar");

  it("uses measured history when enough bins have it", async () => {
    const h = new FakeHistory();
    for (const b of lashkarBins.slice(0, 4)) for (const r of series(b.bin_id, 3, 20)) await h.appendReading(r);
    const out = planFrequency(zones, bins, h, today).find((z) => z.zone_id === "lashkar")!;
    expect(out.fill_rate_pct_per_day).toBeCloseTo(72, 0); // 3 %/h * 24
    expect(out.interval_label).toBe("daily");
  });

  it("keeps the seed rate with too little history", () => {
    const before = zones.find((z) => z.zone_id === "lashkar")!;
    const after = planFrequency(zones, bins, new FakeHistory(), today).find((z) => z.zone_id === "lashkar")!;
    expect(after.fill_rate_pct_per_day).toBe(before.fill_rate_pct_per_day);
    expect(after.interval_label).toBe(before.interval_label);
  });

  it("needs at least minBinsForRate bins with history", async () => {
    const h = new FakeHistory();
    for (const r of series(lashkarBins[0]!.bin_id, 3, 20)) await h.appendReading(r);
    const before = zones.find((z) => z.zone_id === "lashkar")!;
    const after = planFrequency(zones, bins, h, today).find((z) => z.zone_id === "lashkar")!;
    expect(after.fill_rate_pct_per_day).toBe(before.fill_rate_pct_per_day);
  });
});
