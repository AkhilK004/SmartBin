import { createServer } from "node:http";
import { createAdapters } from "./adapters/index.js";
import { loadSnapshot, saveSnapshot } from "./adapters/local.js";
import { config } from "./config.js";
import { initialZones } from "./domain/frequency.js";
import { SettingsStore } from "./settings.js";
import { localDate } from "./time.js";
import cron from "node-cron";
import { defaultPlanDeps } from "./jobs.js";
import { createPipeline } from "./pipeline.js";
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
const pipeline = createPipeline({ bus, store, history, settings });
const ctx: AppContext = { bus, store, history, planDeps: defaultPlanDeps(), settings, pipeline, sim: { speed: 1 } };
const server = createServer(buildApp(ctx));
const socket = attachSocket(server, ctx, pipeline);

// Same HTTP endpoints Cloud Scheduler / EventBridge would call (CLAUDE.md §6).
const callJob = (path: string) => async () => {
  try {
    const res = await fetch(`http://localhost:${config.port}${path}`, { method: "POST" });
    console.log(`${path} -> ${res.status}`);
  } catch (err) {
    console.error(`${path} failed`, err);
  }
};
const tasks = [
  cron.schedule(config.cron.frequency, callJob("/jobs/frequency"), { timezone: config.timezone }),
  cron.schedule(config.cron.daily, callJob("/jobs/daily"), { timezone: config.timezone }),
];

const sweep = setInterval(() => pipeline.sweepOffline(), config.alerts.readingIntervalS * 1000);
const snap = setInterval(() => void saveSnapshot(config.snapshotPath, store.snapshot()), config.snapshotIntervalMs);

server.listen(config.port, () => console.log(`server listening on :${config.port}`));

async function shutdown() {
  tasks.forEach((t) => t.stop());
  clearInterval(sweep);
  clearInterval(snap);
  await saveSnapshot(config.snapshotPath, store.snapshot());
  await socket.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
