import { describe, expect, it } from "vitest";
import { createOsrmClient } from "../src/clients/osrm.js";

const pts = [
  { lat: 26.2, lng: 78.17 },
  { lat: 26.21, lng: 78.18 },
  { lat: 26.22, lng: 78.19 },
];
const failing = (async () => {
  throw new Error("connection refused");
}) as unknown as typeof fetch;

describe("osrm client", () => {
  it("labels the haversine fallback on table failure", async () => {
    const t = await createOsrmClient("http://x", failing).table(pts);
    expect(t.distance_source).toBe("haversine_fallback");
    expect(t.distances_m[0]![1]).toBeGreaterThan(0);
    expect(t.distances_m[0]![0]).toBe(0);
  });

  it("labels the haversine fallback on route failure", async () => {
    const r = await createOsrmClient("http://x", failing).route(pts);
    expect(r.distance_source).toBe("haversine_fallback");
    expect(r.distance_m).toBeGreaterThan(0);
    expect(r.geometry).toHaveLength(3);
  });

  it("uses OSRM values when the server answers", async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ code: "Ok", distances: [[0, 5], [5, 0]], durations: [[0, 9], [9, 0]] }))) as unknown as typeof fetch;
    const t = await createOsrmClient("http://x", ok).table(pts.slice(0, 2));
    expect(t.distance_source).toBe("osrm");
    expect(t.distances_m[0]![1]).toBe(5);
  });
});
