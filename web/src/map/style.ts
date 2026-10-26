import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

/**
 * Dark base map, built here so the same layers work on both tile sources.
 * Both sources use the OpenMapTiles schema.
 *  - With VITE_MAPTILER_KEY: MapTiler vector tiles and terrain-RGB (3D relief).
 *  - Without a key: OpenFreeMap vector tiles, no terrain (the UI says so).
 */
export interface BaseMap {
  style: StyleSpecification;
  terrain: boolean;
  provider: "maptiler" | "openfreemap";
}

const FONT = ["Noto Sans Regular"];

export function buildBaseMap(key: string | undefined): BaseMap {
  const useKey = !!key && key.trim().length > 0;
  const k = key?.trim() ?? "";

  const sources: StyleSpecification["sources"] = useKey
    ? {
        openmaptiles: {
          type: "vector",
          url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${k}`,
          attribution: '<a href="https://www.maptiler.com/copyright/">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
        },
        terrain: {
          type: "raster-dem",
          url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${k}`,
          tileSize: 256,
        },
      }
    : {
        openmaptiles: {
          type: "vector",
          url: "https://tiles.openfreemap.org/planet",
          attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
      };

  const roadWidth = (min: number, max: number) =>
    ["interpolate", ["exponential", 1.4], ["zoom"], 10, min * 0.4, 14, min, 18, max] as unknown as number;

  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": "#0e1013" } },
    {
      id: "landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      paint: { "fill-color": "#11171a", "fill-opacity": 0.9 },
    },
    {
      id: "landuse",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      filter: ["in", ["get", "class"], ["literal", ["residential", "commercial", "industrial", "retail"]]],
      paint: { "fill-color": "#13161b" },
    },
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: { "fill-color": "#101a17" },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "#0a1722" },
    },
    {
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      paint: { "line-color": "#0a1722", "line-width": 1.2 },
    },
    ...(useKey
      ? ([
          {
            id: "hillshade",
            type: "hillshade",
            source: "terrain",
            paint: {
              "hillshade-shadow-color": "#000000",
              "hillshade-highlight-color": "#2a3038",
              "hillshade-accent-color": "#000000",
              "hillshade-exaggeration": 0.45,
            },
          },
        ] as LayerSpecification[])
      : []),
    {
      id: "road-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track", "path"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#22262d", "line-width": roadWidth(1, 4) },
    },
    {
      id: "road-tertiary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["tertiary"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#2c3037", "line-width": roadWidth(1.6, 6) },
    },
    {
      id: "road-main",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["secondary", "primary"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#363b44", "line-width": roadWidth(2.2, 9) },
    },
    {
      id: "road-trunk",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["trunk", "motorway"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#434954", "line-width": roadWidth(2.8, 11) },
    },
    {
      id: "buildings-3d",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13.5,
      paint: {
        "fill-extrusion-color": "#1c2027",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.92,
      },
    },
    {
      id: "place-label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town", "suburb", "neighbourhood", "quarter"]]],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 15, 13],
        "text-letter-spacing": 0.02,
      },
      paint: { "text-color": "#7b7f88", "text-halo-color": "#0e1013", "text-halo-width": 1.5 },
    },
  ];

  const style: StyleSpecification = {
    version: 8,
    name: "smartbin-dark",
    glyphs: useKey
      ? `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${k}`
      : "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources,
    layers,
  };

  return { style, terrain: useKey, provider: useKey ? "maptiler" : "openfreemap" };
}

export const MAP_FONT = FONT;
