import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildBaseMap, MAP_FONT } from "./map/style";
import { useStore } from "./store";
import { CLASS_LABEL, COLOR_HEX, LOCATION_LABEL, fmt } from "./format";
import { truckColor } from "./truckColors";
import type { Bin, Truck } from "./types";

const CENTER: [number, number] = [78.18, 26.22]; // approximate centre of Gwalior
const PITCH = 60;
const BEARING = -14;
const key = import.meta.env.VITE_MAPTILER_KEY;
const base = buildBaseMap(key);

type FC = GeoJSON.FeatureCollection;
const empty: FC = { type: "FeatureCollection", features: [] };

const colorMatch = [
  "match",
  ["get", "color"],
  "green", COLOR_HEX.green,
  "amber", COLOR_HEX.amber,
  "red", COLOR_HEX.red,
  "purple", COLOR_HEX.purple,
  COLOR_HEX.grey,
] as unknown as string;

function popupHtml(b: Bin, zoneLabel: string): string {
  const cls = CLASS_LABEL[b.bin_class];
  const flags = [b.urgent ? "Urgent" : null, b.hazard ? "Hazard" : null, b.predicted_overflow ? "Overflow predicted" : null, b.status === "offline" ? "Offline" : null]
    .filter(Boolean)
    .join(" · ");
  const row = (k: string, v: string) =>
    `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:var(--muted)">${k}</span><span>${v}</span></div>`;
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="width:9px;height:9px;border-radius:50%;background:${COLOR_HEX[b.color]}"></span>
      <strong style="font-size:14px">${b.bin_id}</strong>
      <span style="color:var(--muted)">${LOCATION_LABEL[b.location_type]} · ${zoneLabel}</span>
    </div>
    <div style="font-size:24px;line-height:28px;font-weight:600;margin-bottom:2px">${fmt.pct(b.fill_pct)}<span style="font-size:12px;color:var(--muted);font-weight:400"> full</span></div>
    <div style="color:var(--muted);margin-bottom:8px">${cls}${flags ? " · " + flags : ""}</div>
    ${row("Priority", fmt.dec(b.priority, 0))}
    ${row("Hours to full", Number.isFinite(b.hours_to_full) ? fmt.dec(b.hours_to_full, 1) + " h" : "—")}
    ${row("Battery", fmt.pct(b.battery))}
    ${row("Temperature", fmt.dec(b.temp_c, 1) + " °C")}
    ${row("Gas", fmt.int(b.gas_ppm) + " ppm")}
    ${row("Last seen", fmt.time(b.last_seen))}`;
}

interface TruckMarker {
  marker: maplibregl.Marker;
  arrow: HTMLElement;
  from: [number, number];
  to: [number, number];
  t0: number;
  heading: number;
}

function truckElement(t: Truck): { el: HTMLElement; arrow: HTMLElement } {
  const el = document.createElement("div");
  el.className = "truck-marker";
  const color = truckColor(t.truck_id, t.kind);
  const stroke = t.kind === "secondary_autotipper" ? "#131217" : "#ffffff";
  el.innerHTML = `
    <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 19 20l-7-3.6L5 20z" fill="${color}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>
    <span class="tag">${t.truck_id}</span>`;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `Truck ${t.truck_id}`);
  return { el, arrow: el.querySelector(".arrow") as HTMLElement };
}

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const truckMarkers = useRef<Map<string, TruckMarker>>(new Map());
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);

  const bins = useStore((s) => s.bins);
  const zones = useStore((s) => s.zones);
  const trucks = useStore((s) => s.trucks);
  const sites = useStore((s) => s.sites);
  const plan = useStore((s) => s.plan);
  const hiddenZones = useStore((s) => s.hiddenZones);
  const selectedBinId = useStore((s) => s.selectedBinId);
  const selectedRouteId = useStore((s) => s.selectedRouteId);
  const focus = useStore((s) => s.focus);

  // ---- create the map once ----
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: base.style,
      center: CENTER,
      zoom: 11.6,
      pitch: PITCH,
      bearing: BEARING,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Dev only: lets a browser script project coordinates to pixels when testing clicks.
    if (import.meta.env.DEV) (window as unknown as { __map?: MLMap }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    map.on("load", () => {
      if (base.terrain) map.setTerrain({ source: "terrain", exaggeration: 1.3 });

      map.addSource("zones", { type: "geojson", data: empty });
      map.addSource("zone-labels", { type: "geojson", data: empty });
      map.addSource("routes", { type: "geojson", data: empty });
      map.addSource("bins", { type: "geojson", data: empty });
      map.addSource("sites", { type: "geojson", data: empty });

      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#4a8ad6", "fill-opacity": 0.05 } });
      map.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: { "line-color": "#8a8c92", "line-opacity": 0.55, "line-width": 1, "line-dasharray": [3, 3] },
      });
      map.addLayer({
        id: "zones-label",
        type: "symbol",
        source: "zone-labels",
        layout: { "text-field": ["get", "name"], "text-font": MAP_FONT, "text-size": 12, "text-letter-spacing": 0.04 },
        paint: { "text-color": "#a9acb3", "text-halo-color": "#0e1013", "text-halo-width": 1.5 },
      });

      map.addLayer({
        id: "routes-casing",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0e1013", "line-width": ["case", ["==", ["get", "selected"], 1], 9, 6], "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "routes-line",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "secondary"], 0],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "selected"], 1], 5, 3] },
      });
      map.addLayer({
        id: "routes-line-secondary",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "secondary"], 1],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["==", ["get", "selected"], 1], 5, 3],
          "line-dasharray": [2, 1.5],
        },
      });

      map.addLayer({
        id: "bins-halo",
        type: "circle",
        source: "bins",
        filter: ["any", ["==", ["get", "hazard"], 1], ["==", ["get", "selected"], 1], ["==", ["get", "routed"], 1]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 15],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 2, 1.25],
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#ffffff", ["==", ["get", "hazard"], 1], COLOR_HEX.purple, "rgba(255,255,255,0.4)"],
        },
      });
      map.addLayer({
        id: "bins",
        type: "circle",
        source: "bins",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            11, ["case", ["==", ["get", "must"], 1], 3.4, 2.6],
            16, ["case", ["==", ["get", "must"], 1], 9, 7],
          ],
          "circle-color": colorMatch,
          "circle-opacity": ["case", ["==", ["get", "skipped"], 1], 0.5, 1],
          "circle-stroke-width": 1.25,
          "circle-stroke-color": "#0e1013",
        },
      });
      map.addLayer({
        id: "bins-label",
        type: "symbol",
        source: "bins",
        minzoom: 15.2,
        layout: {
          "text-field": ["concat", ["to-string", ["get", "fill"]], "%"],
          "text-font": MAP_FONT,
          "text-size": 11,
          "text-offset": [0, 1.6],
        },
        paint: { "text-color": "#d6d8dc", "text-halo-color": "#0e1013", "text-halo-width": 1.5 },
      });

      map.addLayer({
        id: "sites",
        type: "circle",
        source: "sites",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 11],
          "circle-color": ["match", ["get", "kind"], "depot", "#131217", "#131217"],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["match", ["get", "kind"], "depot", "#4a8ad6", "#e0a43c"],
        },
      });
      map.addLayer({
        id: "sites-label",
        type: "symbol",
        source: "sites",
        layout: {
          "text-field": ["get", "name"],
          "text-font": MAP_FONT,
          "text-size": 12,
          "text-offset": [0, 1.5],
          "text-anchor": "top",
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#0e1013", "text-halo-width": 1.75 },
      });

      map.on("mouseenter", "bins", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "bins", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "bins", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = String(f.properties?.bin_id);
        useStore.getState().selectBin(id);
      });
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["bins"] });
        if (hit.length === 0) useStore.getState().selectBin(null);
      });

      setReady(true);
    });

    map.on("error", (e) => {
      // Tile or glyph failures show as a quiet note, never a blank map without explanation.
      const status = (e as unknown as { error?: { status?: number } }).error?.status;
      if (status !== undefined) setTileError(true);
    });

    const markers = truckMarkers.current;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const bearing = map.getBearing();
      for (const m of markers.values()) {
        const k = Math.min(1, (now - m.t0) / 1000);
        m.marker.setLngLat([m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k]);
        m.arrow.style.transform = `rotate(${m.heading - bearing}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      for (const m of markers.values()) m.marker.remove();
      markers.clear();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- zones ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const fc: FC = {
      type: "FeatureCollection",
      features: zones
        .filter((z) => !hiddenZones.has(z.zone_id))
        .map((z) => ({
          type: "Feature",
          properties: { zone_id: z.zone_id, name: z.name },
          geometry: { type: "Polygon", coordinates: [[...z.polygon, z.polygon[0]]] },
        })),
    };
    (map.getSource("zones") as GeoJSONSource).setData(fc);
    // One label per zone, at the polygon centre (a polygon source would repeat it on every tile).
    const labels: FC = {
      type: "FeatureCollection",
      features: zones
        .filter((z) => !hiddenZones.has(z.zone_id))
        .map((z) => ({
          type: "Feature",
          properties: { name: z.name },
          geometry: {
            type: "Point",
            coordinates: [
              z.polygon.reduce((a, p) => a + p[0], 0) / z.polygon.length,
              z.polygon.reduce((a, p) => a + p[1], 0) / z.polygon.length,
            ],
          },
        })),
    };
    (map.getSource("zone-labels") as GeoJSONSource).setData(labels);
    if (!fitted.current && zones.length > 0) {
      fitted.current = true;
      // Leave room for the top bar and the legend so the bins are not under them.
      const narrow = window.innerWidth <= 860;
      map.fitBounds(boundsOf(zones.flatMap((z) => z.polygon)), {
        padding: narrow ? { top: 110, bottom: 40, left: 16, right: 16 } : { top: 110, bottom: 190, left: 70, right: 70 },
        pitch: PITCH,
        bearing: BEARING,
        duration: 0,
      });
    }
  }, [ready, zones, hiddenZones]);

  // ---- bins ----
  const routedIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of plan?.routes ?? []) for (const st of r.stops) if (st.type === "bin" && st.bin_id) s.add(st.bin_id);
    return s;
  }, [plan]);
  const skippedIds = useMemo(() => new Set((plan?.skip_list ?? []).map((s) => s.bin_id)), [plan]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const fc: FC = {
      type: "FeatureCollection",
      features: Object.values(bins)
        .filter((b) => !hiddenZones.has(b.zone_id))
        .map((b) => ({
          type: "Feature",
          properties: {
            bin_id: b.bin_id,
            color: b.color,
            fill: Math.round(b.fill_pct),
            hazard: b.hazard ? 1 : 0,
            must: b.bin_class === "must_visit" ? 1 : 0,
            selected: b.bin_id === selectedBinId ? 1 : 0,
            routed: routedIds.has(b.bin_id) ? 1 : 0,
            skipped: skippedIds.has(b.bin_id) ? 1 : 0,
          },
          geometry: { type: "Point", coordinates: [b.lng, b.lat] },
        })),
    };
    (map.getSource("bins") as GeoJSONSource).setData(fc);
  }, [ready, bins, hiddenZones, selectedBinId, routedIds, skippedIds]);

  // ---- popup for the selected bin ----
  const popupBin = useRef<string | null>(null);
  const selectedBin = selectedBinId ? bins[selectedBinId] : undefined;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!selectedBin) {
      // Closing from here must not clear the selection again.
      const p = popupRef.current;
      popupRef.current = null;
      popupBin.current = null;
      p?.remove();
      return;
    }
    const zoneLabel = zones.find((z) => z.zone_id === selectedBin.zone_id)?.name ?? selectedBin.zone_id;
    const html = popupHtml(selectedBin, zoneLabel);
    if (popupRef.current && popupBin.current === selectedBin.bin_id) {
      // Same bin, new reading: refresh the text in place.
      popupRef.current.setHTML(html);
      return;
    }
    const old = popupRef.current;
    popupRef.current = null;
    old?.remove();
    const id = selectedBin.bin_id;
    const popup = new maplibregl.Popup({ offset: 16, closeButton: true, maxWidth: "280px" })
      .setLngLat([selectedBin.lng, selectedBin.lat])
      .setHTML(html)
      .addTo(map);
    popup.on("close", () => {
      if (popupRef.current === popup && useStore.getState().selectedBinId === id) useStore.getState().selectBin(null);
    });
    popupRef.current = popup;
    popupBin.current = id;
  }, [ready, selectedBin, zones]);

  // ---- routes ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const fc: FC = {
      type: "FeatureCollection",
      features: (plan?.routes ?? [])
        .filter((r) => r.geometry.length > 1)
        .map((r) => ({
          type: "Feature",
          properties: {
            route_id: r.route_id,
            color: truckColor(r.truck_id, r.truck_kind),
            secondary: r.truck_kind === "secondary_autotipper" ? 1 : 0,
            selected: r.route_id === selectedRouteId ? 1 : 0,
          },
          geometry: { type: "LineString", coordinates: r.geometry },
        })),
    };
    (map.getSource("routes") as GeoJSONSource).setData(fc);
  }, [ready, plan, selectedRouteId]);

  // ---- depot and dump yard ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const fc: FC = {
      type: "FeatureCollection",
      features: sites.map((s) => ({
        type: "Feature",
        properties: { kind: s.kind, name: s.name },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      })),
    };
    (map.getSource("sites") as GeoJSONSource).setData(fc);
  }, [ready, sites]);

  // ---- trucks: markers glide between the 1 s updates ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const markers = truckMarkers.current;
    const seen = new Set<string>();
    const now = performance.now();
    for (const t of trucks) {
      seen.add(t.truck_id);
      const existing = markers.get(t.truck_id);
      if (!existing) {
        const { el, arrow } = truckElement(t);
        el.addEventListener("click", () => useStore.getState().setTab("overview"));
        const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([t.lng, t.lat]).addTo(map);
        markers.set(t.truck_id, { marker, arrow, from: [t.lng, t.lat], to: [t.lng, t.lat], t0: now, heading: t.heading_deg });
      } else {
        const cur = existing.marker.getLngLat();
        existing.from = [cur.lng, cur.lat];
        existing.to = [t.lng, t.lat];
        existing.t0 = now;
        existing.heading = t.heading_deg;
      }
    }
    for (const [id, m] of markers) {
      if (!seen.has(id)) {
        m.marker.remove();
        markers.delete(id);
      }
    }
  }, [ready, trucks]);

  // ---- camera requests from the panels ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    const st = useStore.getState();
    if (focus.kind === "zone") {
      const z = st.zones.find((x) => x.zone_id === focus.id);
      if (z) map.fitBounds(boundsOf(z.polygon), { padding: 80, pitch: PITCH, duration: 900 });
    } else if (focus.kind === "truck") {
      const t = st.trucks.find((x) => x.truck_id === focus.id);
      if (t) map.flyTo({ center: [t.lng, t.lat], zoom: Math.max(map.getZoom(), 15), pitch: PITCH, duration: 900 });
    } else if (focus.kind === "bin") {
      const b = st.bins[focus.id];
      if (b) map.flyTo({ center: [b.lng, b.lat], zoom: Math.max(map.getZoom(), 16), pitch: PITCH, duration: 900 });
    } else if (focus.kind === "route") {
      const r = st.plan?.routes.find((x) => x.route_id === focus.id);
      if (r && r.geometry.length > 1) map.fitBounds(boundsOf(r.geometry), { padding: 90, pitch: PITCH, duration: 900 });
    }
  }, [ready, focus]);

  return (
    <div className="relative h-full w-full bg-ground">
      <div ref={container} className="absolute inset-0" aria-label="3D map of Gwalior bins, trucks and routes" role="application" />
      <div className="pointer-events-none absolute bottom-8 right-12 flex flex-col items-end gap-1 text-small text-muted">
        {!base.terrain && (
          <span className="rounded-card border border-line bg-surface/90 px-2 py-0.5">
            No terrain: set VITE_MAPTILER_KEY for 3D relief
          </span>
        )}
        {tileError && (
          <span className="rounded-card border border-line bg-surface/90 px-2 py-0.5 text-warning">
            Some map tiles could not load
          </span>
        )}
      </div>
    </div>
  );
}

function boundsOf(points: [number, number][]): LngLatBoundsLike {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [
    [w, s],
    [e, n],
  ];
}
