import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LocalBus, MemoryStore } from "../src/adapters/local.js";
import type { HistoryStore } from "../src/adapters/types.js";
import type { PlanDeps } from "../src/domain/dispatch.js";
import { initialZones } from "../src/domain/frequency.js";
import { createPipeline } from "../src/pipeline.js";
import { SavingsService } from "../src/savings.js";
import { SettingsStore } from "../src/settings.js";
import { localDate } from "../src/time.js";
import { buildApp, type AppContext } from "../src/routes.js";
import { SITES, seedBins, seedFleet, seedZoneBases } from "../src/seed.js";
import { attachSocket } from "../src/socket.js";
import type { SensorReading } from "../src/types.js";

export const NOW = new Date("2026-10-26T10:00:00Z");

export class FakeHistory implements HistoryStore {
  readingsLog: SensorReading[] = [];
  async appendReading(r: SensorReading) {
    this.readingsLog.push(r);
  }
  emptyingLog: { bin_id: string; at: string }[] = [];
  async appendEmptying(e: { bin_id: string; at: string }) {
    this.emptyingLog.push(e);
  }
  readings(binId: string, sinceIso?: string) {
    return this.readingsLog.filter((r) => r.bin_id === binId && (!sinceIso || r.timestamp >= sinceIso));
  }
  emptyings(binId: string) {
    return this.emptyingLog.filter((e) => e.bin_id === binId);
  }
}

const failingPlanDeps: PlanDeps = {
  optimize: async () => {
    throw new Error("optimizer not available in this test");
  },
  baseline: async () => {
    throw new Error("optimizer not available in this test");
  },
  roadRoute: async (pts) => ({
    geometry: pts.map((p) => [p.lng, p.lat] as [number, number]),
    leg_distances_m: pts.slice(1).map(() => 1000),
    distance_source: "osrm",
  }),
};

export function makeWorld(opts: { clock?: () => Date; fetchImpl?: typeof fetch; planDeps?: PlanDeps } = {}) {
  const bus = new LocalBus();
  const store = new MemoryStore();
  const bins = seedBins(60, NOW);
  store.restore({ bins, zones: initialZones(seedZoneBases(bins), localDate(NOW)), trucks: seedFleet(), sites: SITES, alerts: [] });
  const history = new FakeHistory();
  const clock = opts.clock ?? (() => NOW);
  const settings = new SettingsStore();
  const pipeline = createPipeline({ bus, store, history, settings, clock });
  const planDeps = opts.planDeps ?? failingPlanDeps;
  const holder: { ctx?: AppContext } = {};
  const savings = new SavingsService(
    store,
    pipeline.events,
    () => holder.ctx?.simControl?.status().overflows_missed ?? { by_date: {}, total: { baseline: 0, optimized: 0 } },
  );
  const ctx: AppContext = { bus, store, history, planDeps, settings, pipeline, savings, sim: { speed: 1 }, clock, fetchImpl: opts.fetchImpl };
  holder.ctx = ctx;
  const server: Server = createServer(buildApp(ctx));
  const socket = attachSocket(server, ctx, pipeline);
  return { bus, store, history, ctx, pipeline, server, socket };
}

export async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, r));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

export const reading = (bin_id: string, over: Partial<SensorReading> = {}): SensorReading => ({
  bin_id,
  fill_pct: 50,
  lat: 26.21,
  lng: 78.17,
  battery: 80,
  temp_c: 30,
  gas_ppm: 100,
  timestamp: NOW.toISOString(),
  ...over,
});

export const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
