import { createServer } from "node:http";
import { createAdapters } from "./adapters/index.js";
import { loadSnapshot, saveSnapshot } from "./adapters/local.js";
import { config } from "./config.js";
import { initialZones } from "./domain/frequency.js";
import { SettingsStore } from "./settings.js";
import { localDate } from "./time.js";
import cron from "node-cron";
import { SimClock } from "./sim/clock.js";
import { SimEngine } from "./sim/engine.js";
import { defaultPlanDeps } from "./jobs.js";
import { createPipeline } from "./pipeline.js";
import { SavingsService } from "./savings.js";
import { buildApp, type AppContext } from "./routes.js";
import { SITES, seedBins, seedFleet, seedZoneBases } from "./seed.js";
import { attachSocket } from "./socket.js";

const { bus, store, history } = await createAdapters();

const saved = await loadSnapshot(config.snapshotPath);
if (saved) {
  store.restore(saved);
  console.log(`restored ${saved.bins.length} bins from ${config.snapshotPath}`);
} else {
  const bins = seedBins();
  store.restore({ bins, zones: initialZones(seedZoneBases(bins), localDate(new Date())), trucks: seedFleet(), sites: SITES, alerts: [] });
  console.log(`seeded ${bins.length} bins`);
}

const settings = new SettingsStore();
const simClock = config.sim.enabled ? new SimClock() : undefined;
const clock = simClock ? () => simClock.now() : undefined;
const pipeline = createPipeline({ bus, store, history, settings, clock });
let engine: SimEngine | undefined;
const savings = new SavingsService(
  store,
  pipeline.events,
  () => engine?.status().overflows_missed ?? { by_date: {}, total: { baseline: 0, optimized: 0 } },
);
const ctx: AppContext = { bus, store, history, planDeps: defaultPlanDeps(), settings, pipeline, savings, sim: { speed: 1 }, clock };
const server = createServer(buildApp(ctx));
const socket = attachSocket(server, ctx, pipeline);

// Same HTTP endpoints Cloud Scheduler / EventBridge would call (CLAUDE.md §6).
const self = `http://127.0.0.1:${config.port}`;
const callJob = async (path: string) => {
  const res = await fetch(`${self}${path}`, { method: "POST" });
  console.log(`${path} -> ${res.status}`);
};
// With the simulator on, jobs fire on simulated time (same endpoints); otherwise on real time.
const tasks = simClock
  ? []
  : [
      cron.schedule(config.cron.frequency, () => void callJob("/jobs/frequency").catch(console.error), { timezone: config.timezone }),
      cron.schedule(config.cron.daily, () => void callJob("/jobs/daily").catch(console.error), { timezone: config.timezone }),
    ];

const sweep = setInterval(() => pipeline.sweepOffline(), config.alerts.readingIntervalS * 1000);
const snap = setInterval(() => void saveSnapshot(config.snapshotPath, store.snapshot()), config.snapshotIntervalMs);

server.listen(config.port, () => {
  console.log(`server listening on :${config.port}`);
  if (!simClock) return;
  engine = new SimEngine({
    store,
    history,
    pipeline,
    clock: simClock,
    sim: ctx.sim,
    publish: async (readings) => {
      // same door a real device uses
      await fetch(`${self}/ingest/readings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(readings),
      });
    },
    callJob,
  });
  ctx.simControl = engine;
  engine.start();
  console.log("simulator on (SIM=off to disable)");
});

async function shutdown() {
  engine?.stop();
  tasks.forEach((t) => t.stop());
  clearInterval(sweep);
  clearInterval(snap);
  await saveSnapshot(config.snapshotPath, store.snapshot());
  await socket.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
