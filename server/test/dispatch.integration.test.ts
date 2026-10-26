// Runs the real optimizer service (Python, OR-Tools). OSRM is deliberately unreachable so
// distances are the deterministic haversine fallback. Skipped when the optimizer venv is missing.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOptimizerClient } from "../src/clients/optimizer.js";
import { buildPlan, type PlanDeps } from "../src/domain/dispatch.js";
import { SettingsStore, type Settings } from "../src/settings.js";
import type { Bin } from "../src/types.js";
import { bin, input } from "./dispatch.helpers.js";

const optimizerDir = resolve("../optimizer");
const python = [".venv/Scripts/python.exe", ".venv/bin/python"].map((p) => resolve(optimizerDir, p)).find(existsSync);
const PORT = 8765;
let proc: ChildProcess | undefined;

async function waitForHealth(): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let up = false;
beforeAll(async () => {
  if (!python) return;
  proc = spawn(python, ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], {
    cwd: optimizerDir,
    env: { ...process.env, OSRM_URL: "http://127.0.0.1:9" },
    stdio: "ignore",
  });
  up = await waitForHealth();
}, 30_000);
afterAll(() => {
  proc?.kill();
});

const client = () => createOptimizerClient(`http://127.0.0.1:${PORT}`);
const deps = (): PlanDeps => ({
  ...client(),
  roadRoute: async (pts) => ({ geometry: pts.map((p) => [p.lng, p.lat] as [number, number]), distance_source: "haversine_fallback" }),
});

// Depot is (26.199, 78.195). One km of latitude ~ 0.009 deg, of longitude ~ 0.01 deg.
const KM = { lat: 0.009, lng: 0.01 };

function world(settings?: Settings): Bin[] {
  // Zone clears the 2400 kg minimum with twenty-five 80% bins (96 kg) 1 km north of the depot (optional, cheap).
  const north = Array.from({ length: 25 }, (_, i) =>
    bin("lashkar", { fill_pct: 80, lat: 26.199 + KM.lat, lng: 78.195 + i * 0.00001, location_type: "market" }, settings),
  );
  const must = bin("lashkar", { bin_id: "B-MUST", fill_pct: 90, lat: 26.199 + KM.lat, lng: 78.195 }, settings);
  // Two optional bins mirrored 1 km east and 1 km west of the depot: same detour (about 2.0 km), same fill;
  // only the location type differs. (Co-located bins would share one detour, so they are not used.)
  const same = { lat: 26.199, fill_pct: 45 };
  return [
    ...north,
    must,
    bin("lashkar", { bin_id: "B-PARK", location_type: "park", lng: 78.195 - KM.lng, ...same }, settings),
    bin("lashkar", { bin_id: "B-MARKET", location_type: "market", lng: 78.195 + KM.lng, ...same }, settings),
  ];
}

describe.skipIf(!python)("dispatch against the real optimizer", { timeout: 60_000 }, () => {
  it("is reachable", () => {
    expect(up).toBe(true);
  });

  it("changing the priority weights changes which optional bins are dropped", async () => {
    const settings = new SettingsStore();
    // like the daily job, re-derive every bin from the current settings before planning
    const dropped = async () =>
      (await buildPlan(input(world(settings.get()), { settings: settings.get(), timeLimitS: 1 }), deps())).dropped_optional
        .map((d) => d.bin_id)
        .sort();

    // default weights: location counts, so the park bin is worth less than the detour and the market bin is worth more
    expect(await dropped()).toEqual(["B-PARK"]);

    // fill-only weights: both bins have fill 45, so both are worth the same and both are kept
    expect(settings.update({ priority_weights: { fill: 1, overflow_risk: 0, location: 0 } })).toBeNull();
    expect(await dropped()).toEqual([]);

    // location-only weights: the park bin is worth 30 and is dropped again, the market bin (100) stays
    expect(settings.update({ priority_weights: { fill: 0, overflow_risk: 0, location: 1 } })).toBeNull();
    expect(await dropped()).toEqual(["B-PARK"]);
  });

  it("changing penalty_scale changes the dropped bins too", async () => {
    const settings = new SettingsStore();
    const bins = world();
    settings.update({ penalty_scale: 5 });
    const low = (await buildPlan(input(bins, { settings: settings.get(), timeLimitS: 1 }), deps())).dropped_optional.map((d) => d.bin_id);
    settings.update({ penalty_scale: 500 });
    const high = (await buildPlan(input(bins, { settings: settings.get(), timeLimitS: 1 }), deps())).dropped_optional.map((d) => d.bin_id);
    expect(low).toContain("B-MARKET");
    expect(high).toEqual([]);
  });

  it("builds a full plan: must-visit kept, secondary truck for a lone urgent bin, baseline present", async () => {
    const urgent = bin("morar", { bin_id: "B-URG", fill_pct: 97, lat: 26.205, lng: 78.2 });
    const plan = await buildPlan(input([...world(), urgent], { timeLimitS: 1 }), deps());

    expect(plan.error).toBeNull();
    const primary = plan.routes.find((r) => r.truck_kind === "primary_compactor")!;
    expect(primary.stops.some((s) => s.bin_id === "B-MUST")).toBe(true);
    const secondary = plan.routes.find((r) => r.truck_kind === "secondary_autotipper")!;
    expect(secondary.stops.map((s) => s.bin_id)).toEqual(["B-URG"]);
    expect(plan.baseline!.stops).toBe(world().length);
    expect(plan.routes.every((r) => r.distance_m > 0)).toBe(true);
  });

  it("reports an infeasible must-visit set as plan.error", async () => {
    // a must-visit bin 400 km away cannot be reached within the 8 h shift
    const far = bin("lashkar", { bin_id: "B-FAR", fill_pct: 95, lat: 29.8, lng: 78.195 });
    const plan = await buildPlan(input([...world().slice(0, 25), far], { timeLimitS: 1 }), deps());
    expect(plan.error).toMatch(/infeasible|shift limit|must-visit/i);
  });
});
