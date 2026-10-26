import { EventEmitter } from "node:events";
import type { HistoryStore, MessageBus, StateStore } from "./adapters/types.js";
import { config } from "./config.js";
import { AlertTracker } from "./domain/alerts.js";
import { deriveBin } from "./domain/classify.js";
import type { SettingsStore } from "./settings.js";
import type { Alert, Bin, BinBase, SensorReading } from "./types.js";

/** Events: "bins:changed" (Bin, derived fields included), "alert:new" (Alert). */
export interface Pipeline {
  events: EventEmitter;
  /** Mark bins with no reading for N intervals as offline and alert once. */
  sweepOffline(): void;
  /** Stored bin plus derived class, colour and priority. */
  enrich(bin: BinBase): Bin;
}

export function createPipeline(deps: {
  bus: MessageBus;
  store: StateStore;
  history: HistoryStore;
  settings: SettingsStore;
  clock?: () => Date;
}): Pipeline {
  const { bus, store, history, settings } = deps;
  const clock = deps.clock ?? (() => new Date());
  const events = new EventEmitter();
  const tracker = new AlertTracker();
  tracker.prime(store.getBins(), store.getAlerts(), settings.get());

  const enrich = (bin: BinBase): Bin => {
    const zone = store.getZones().find((z) => z.zone_id === bin.zone_id);
    if (!zone) throw new Error(`bin ${bin.bin_id} references unknown zone ${bin.zone_id}`);
    return deriveBin(bin, zone, settings.get(), clock());
  };

  const publishAlerts = (alerts: Alert[]) => {
    for (const a of alerts) {
      store.addAlert(a);
      events.emit("alert:new", a);
    }
  };

  const changed = (bin: BinBase) => {
    events.emit("bins:changed", enrich(bin));
    publishAlerts(tracker.evaluate(bin, clock(), settings.get()));
  };

  bus.subscribe(async (r: SensorReading) => {
    const bin = store.getBin(r.bin_id);
    if (!bin) return; // unknown bins are rejected at the HTTP edge
    const updated: BinBase = {
      ...bin,
      fill_pct: r.fill_pct,
      lat: r.lat,
      lng: r.lng,
      battery: r.battery,
      temp_c: r.temp_c,
      gas_ppm: r.gas_ppm,
      last_seen: r.timestamp,
      status: "online",
    };
    store.upsertBin(updated);
    await history.appendReading(r);
    changed(updated);
  });

  return {
    events,
    enrich,
    sweepOffline() {
      const now = clock();
      const limitMs = config.alerts.offlineAfterMissedIntervals * config.alerts.readingIntervalS * 1000;
      for (const bin of store.getBins()) {
        if (bin.status === "offline") continue;
        if (now.getTime() - new Date(bin.last_seen).getTime() <= limitMs) continue;
        const updated: BinBase = { ...bin, status: "offline" };
        store.upsertBin(updated);
        changed(updated);
      }
    },
  };
}
