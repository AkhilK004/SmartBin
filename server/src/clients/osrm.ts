import { config } from "../config.js";
import { haversineM } from "../geo.js";
import type { DistanceSource } from "../types.js";

export interface LngLat {
  lat: number;
  lng: number;
}

export interface TableResult {
  distances_m: number[][];
  durations_s: number[][];
  distance_source: DistanceSource;
}

export interface RouteResult {
  /** [lng, lat] polyline along roads (empty on fallback: straight segments). */
  geometry: [number, number][];
  distance_m: number;
  duration_s: number;
  distance_source: DistanceSource;
}

type FetchFn = typeof fetch;

export function createOsrmClient(baseUrl = config.osrmUrl, fetchImpl: FetchFn = fetch) {
  const coords = (pts: LngLat[]) => pts.map((p) => `${p.lng},${p.lat}`).join(";");

  async function get(path: string): Promise<any> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(config.osrmTimeoutMs),
    });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const body = (await res.json()) as { code?: string };
    if (body.code !== "Ok") throw new Error(`OSRM code ${body.code}`);
    return body;
  }

  /** Haversine fallback (CLAUDE.md §3.8): always labelled. */
  function fallbackTable(pts: LngLat[]): TableResult {
    const distances_m = pts.map((a) =>
      pts.map((b) => Math.round(haversineM(a.lat, a.lng, b.lat, b.lng) * config.haversineRoadFactor)),
    );
    const durations_s = distances_m.map((row) =>
      row.map((d) => Math.round(d / ((config.truckSpeedKmh * 1000) / 3600))),
    );
    return { distances_m, durations_s, distance_source: "haversine_fallback" };
  }

  return {
    async table(pts: LngLat[]): Promise<TableResult> {
      try {
        const body = await get(`/table/v1/driving/${coords(pts)}?annotations=distance,duration`);
        return {
          distances_m: body.distances,
          durations_s: body.durations,
          distance_source: "osrm",
        };
      } catch {
        return fallbackTable(pts);
      }
    },

    async route(pts: LngLat[]): Promise<RouteResult> {
      try {
        const body = await get(`/route/v1/driving/${coords(pts)}?overview=full&geometries=geojson`);
        const r = body.routes[0];
        return {
          geometry: r.geometry.coordinates,
          distance_m: r.distance,
          duration_s: r.duration,
          distance_source: "osrm",
        };
      } catch {
        const t = fallbackTable(pts);
        let distance_m = 0;
        let duration_s = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          distance_m += t.distances_m[i]![i + 1]!;
          duration_s += t.durations_s[i]![i + 1]!;
        }
        return {
          geometry: pts.map((p) => [p.lng, p.lat] as [number, number]),
          distance_m,
          duration_s,
          distance_source: "haversine_fallback",
        };
      }
    },
  };
}
