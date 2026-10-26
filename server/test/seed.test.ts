import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../src/geo.js";
import { SITES, seedBins, seedFleet, seedZoneBases } from "../src/seed.js";
import { config } from "../src/config.js";

const [minLng, minLat, maxLng, maxLat] = config.bbox;
const inBbox = (lat: number, lng: number) => lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;

describe("seed", () => {
  it("seeds the configured bin count with unique ids", () => {
    const bins = seedBins();
    expect(bins).toHaveLength(config.seedBinCount);
    expect(new Set(bins.map((b) => b.bin_id)).size).toBe(bins.length);
  });

  it("puts every bin inside its zone and the bbox", () => {
    const bins = seedBins();
    const zones = Object.fromEntries(seedZoneBases(bins).map((z) => [z.zone_id, z]));
    for (const b of bins) {
      expect(pointInPolygon(b.lng, b.lat, zones[b.zone_id]!.polygon)).toBe(true);
      expect(inBbox(b.lat, b.lng)).toBe(true);
    }
  });

  it("scales to 150 and 200 bins", () => {
    for (const n of [150, 200]) {
      const bins = seedBins(n);
      expect(bins).toHaveLength(n);
      expect(new Set(bins.map((b) => b.bin_id)).size).toBe(n);
    }
  });

  it("is deterministic", () => {
    const t = new Date("2026-10-26T00:00:00Z");
    expect(seedBins(60, t)).toEqual(seedBins(60, t));
  });

  it("covers all six zones with a computed seed rate", () => {
    const zones = seedZoneBases(seedBins());
    expect(zones).toHaveLength(6);
    for (const z of zones) expect(z.fill_rate_pct_per_day).toBeGreaterThan(0);
  });

  it("builds the fleet from config and places sites inside the bbox", () => {
    const fleet = seedFleet();
    expect(fleet.filter((t) => t.kind === "primary_compactor")).toHaveLength(config.fleet.primaryCount);
    expect(fleet.filter((t) => t.kind === "secondary_autotipper")).toHaveLength(config.fleet.secondaryCount);
    expect(fleet.every((t) => t.capacity_kg === config.fleet.capacityKg[t.kind])).toBe(true);
    for (const s of SITES) expect(inBbox(s.lat, s.lng)).toBe(true);
  });
});
