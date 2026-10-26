// Seed world for the local demo.
// ASSUMPTION (CLAUDE.md §10): every coordinate, zone boundary, depot and dump-yard
// location below is APPROXIMATE and must be verified on the map.

import { config } from "./config.js";
import { haversineM, pointInPolygon } from "./geo.js";
import type { BinBase, LocationType, Site, Truck, ZoneBase, ZoneId } from "./types.js";

const rect = (w: number, s: number, e: number, n: number): [number, number][] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
];

const ZONE_DEFS: { zone_id: ZoneId; name: string; polygon: [number, number][]; mix: LocationType[] }[] = [
  {
    zone_id: "maharaj_bada",
    name: "Maharaj Bada",
    polygon: rect(78.153, 26.2, 78.183, 26.226),
    mix: ["market", "market", "bus_stand", "commercial", "school", "residential", "residential", "park"],
  },
  {
    zone_id: "lashkar",
    name: "Lashkar",
    polygon: rect(78.135, 26.172, 78.165, 26.198),
    mix: ["market", "commercial", "hospital", "school", "residential", "residential", "residential", "park"],
  },
  {
    zone_id: "city_centre",
    name: "City Centre",
    polygon: rect(78.185, 26.2, 78.215, 26.226),
    mix: ["market", "commercial", "commercial", "hospital", "bus_stand", "school", "residential", "park"],
  },
  {
    zone_id: "thatipur",
    name: "Thatipur",
    polygon: rect(78.19, 26.167, 78.22, 26.193),
    mix: ["commercial", "school", "residential", "residential", "residential", "residential", "market", "park"],
  },
  {
    zone_id: "morar",
    name: "Morar",
    polygon: rect(78.23, 26.217, 78.26, 26.243),
    mix: ["market", "hospital", "school", "residential", "residential", "residential", "commercial", "park"],
  },
  {
    zone_id: "hazira",
    name: "Hazira",
    polygon: rect(78.167, 26.172, 78.188, 26.198),
    mix: ["commercial", "bus_stand", "school", "residential", "residential", "market", "commercial", "park"],
  },
];

export const SITES: Site[] = [
  { site_id: "depot", kind: "depot", name: "Main Depot (approx.)", lat: 26.199, lng: 78.195 },
  { site_id: "dump_yard", kind: "dump_yard", name: "Dump Yard (approx.)", lat: 26.175, lng: 78.24 },
];

/** Deterministic PRNG so a given SEED_BIN_COUNT always yields the same world. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN_BIN_SPACING_M = 60;
const PLACEMENT_ATTEMPTS = 500;
const SEED_RNG = 20261026;

export function seedZoneBases(bins: BinBase[]): ZoneBase[] {
  return ZONE_DEFS.map((z) => {
    const own = bins.filter((b) => b.zone_id === z.zone_id);
    const avgPerHour = own.reduce((s, b) => s + b.fill_rate_pct_per_hour, 0) / Math.max(own.length, 1);
    return {
      zone_id: z.zone_id,
      name: z.name,
      polygon: z.polygon,
      fill_rate_pct_per_day: Math.round(avgPerHour * 24 * 10) / 10,
    };
  });
}

export function seedBins(count = config.seedBinCount, now = new Date()): BinBase[] {
  const rand = mulberry32(SEED_RNG);
  const bins: BinBase[] = [];
  const base = Math.floor(count / ZONE_DEFS.length);
  const extra = count % ZONE_DEFS.length;
  const nowIso = now.toISOString();
  const emptiedIso = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  ZONE_DEFS.forEach((zone, zi) => {
    const n = base + (zi < extra ? 1 : 0);
    const xs = zone.polygon.map((p) => p[0]);
    const ys = zone.polygon.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const placed: { lat: number; lng: number }[] = [];

    for (let i = 0; i < n; i++) {
      let pos: { lat: number; lng: number } | null = null;
      for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
        const lng = minX + rand() * (maxX - minX);
        const lat = minY + rand() * (maxY - minY);
        if (!pointInPolygon(lng, lat, zone.polygon)) continue;
        // relax spacing for dense zones (150+ bins) after half the attempts
        const spacing = attempt < PLACEMENT_ATTEMPTS / 2 ? MIN_BIN_SPACING_M : MIN_BIN_SPACING_M / 3;
        if (placed.some((p) => haversineM(p.lat, p.lng, lat, lng) < spacing)) continue;
        pos = { lat, lng };
        break;
      }
      if (!pos) throw new Error(`could not place bin ${i} in zone ${zone.zone_id}`);
      placed.push(pos);

      const location_type = zone.mix[i % zone.mix.length]!;
      const rate = config.fillRatePctPerHour[location_type] * (0.8 + rand() * 0.4);
      bins.push({
        bin_id: `B-${String(bins.length + 1).padStart(3, "0")}`,
        zone_id: zone.zone_id,
        location_type,
        lat: Math.round(pos.lat * 1e6) / 1e6,
        lng: Math.round(pos.lng * 1e6) / 1e6,
        fill_pct: Math.round((5 + rand() * 90) * 10) / 10,
        fill_rate_pct_per_hour: Math.round(rate * 100) / 100,
        battery: Math.round(60 + rand() * 40),
        temp_c: Math.round((25 + rand() * 10) * 10) / 10,
        gas_ppm: Math.round(50 + rand() * 150),
        complaint: false,
        status: "online",
        last_seen: nowIso,
        last_emptied: emptiedIso,
      });
    }
  });
  return bins;
}

export function seedFleet(): Truck[] {
  const depot = SITES.find((s) => s.kind === "depot")!;
  const mk = (truck_id: string, kind: Truck["kind"]): Truck => ({
    truck_id,
    kind,
    capacity_kg: config.fleet.capacityKg[kind],
    load_kg: 0,
    lat: depot.lat,
    lng: depot.lng,
    heading_deg: 0,
    status: "idle",
    route_id: null,
    next_stop_bin_id: null,
  });
  return [
    ...Array.from({ length: config.fleet.primaryCount }, (_, i) => mk(`T-P${i + 1}`, "primary_compactor")),
    ...Array.from({ length: config.fleet.secondaryCount }, (_, i) => mk(`T-S${i + 1}`, "secondary_autotipper")),
  ];
}

export const ZONE_POLYGONS = Object.fromEntries(ZONE_DEFS.map((z) => [z.zone_id, z.polygon])) as Record<
  ZoneId,
  [number, number][]
>;
