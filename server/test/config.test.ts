import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";

describe("config", () => {
  it("has classification thresholds from CLAUDE.md §4", () => {
    expect(config.thresholds.skipBelowPct).toBe(40);
    expect(config.thresholds.mustVisitAbovePct).toBe(85);
    expect(config.thresholds.urgentAtPct).toBe(95);
  });

  it("default priority weights sum to 1", () => {
    const w = config.priorityWeights;
    expect(w.fill + w.overflowRisk + w.location).toBeCloseTo(1);
  });

  it("covers every location type", () => {
    expect(Object.keys(config.locationWeight)).toHaveLength(7);
    expect(Object.keys(config.fillRatePctPerHour)).toHaveLength(7);
  });
});
