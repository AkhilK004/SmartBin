import { EventEmitter } from "node:events";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config.js";
import type { Alert, BinBase, LedgerDay, Plan, SensorReading, Site, Truck, Zone } from "../types.js";
import type { Emptying, HistoryStore, MessageBus, Snapshot, StateStore } from "./types.js";

export class LocalBus implements MessageBus {
  private ee = new EventEmitter();

  async publish(reading: SensorReading): Promise<void> {
    this.ee.emit("reading", reading);
  }

  subscribe(handler: (reading: SensorReading) => void | Promise<void>): void {
    this.ee.on("reading", (r: SensorReading) => {
      Promise.resolve(handler(r)).catch((err) => console.error("bus handler failed", err));
    });
  }
}

export class MemoryStore implements StateStore {
  private bins = new Map<string, BinBase>();
  private zones: Zone[] = [];
  private trucks: Truck[] = [];
  private sites: Site[] = [];
  private alerts: Alert[] = [];
  private plan: Plan | null = null;
  private ledger: Record<string, LedgerDay> = {};

  constructor(initial?: Snapshot) {
    if (initial) this.restore(initial);
  }

  getBins = () => [...this.bins.values()];
  getBin = (id: string) => this.bins.get(id);
  upsertBin = (bin: BinBase) => void this.bins.set(bin.bin_id, bin);
  getZones = () => this.zones;
  setZones = (zones: Zone[]) => void (this.zones = zones);
  getTrucks = () => this.trucks;
  setTrucks = (trucks: Truck[]) => void (this.trucks = trucks);
  getSites = () => this.sites;
  getAlerts = () => this.alerts;
  getPlan = () => this.plan;
  setPlan = (plan: Plan) => void (this.plan = plan);
  getLedger = () => this.ledger;
  setLedgerDay = (date: string, day: LedgerDay) => void (this.ledger[date] = day);

  addAlert(alert: Alert): void {
    this.alerts.push(alert);
    if (this.alerts.length > config.alerts.maxAlertsKept) this.alerts.shift();
  }

  snapshot(): Snapshot {
    return {
      bins: this.getBins(),
      zones: this.zones,
      trucks: this.trucks,
      sites: this.sites,
      alerts: this.alerts,
      plan: this.plan,
      ledger: this.ledger,
    };
  }

  restore(s: Snapshot): void {
    this.bins = new Map(s.bins.map((b) => [b.bin_id, b]));
    this.zones = s.zones;
    this.trucks = s.trucks;
    this.sites = s.sites;
    this.alerts = s.alerts;
    this.plan = s.plan ?? null;
    this.ledger = s.ledger ?? {};
  }
}

/** Writes snapshots atomically (temp file + rename). */
export async function saveSnapshot(path: string, snapshot: Snapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot));
  await rename(tmp, path);
}

export async function loadSnapshot(path: string): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Snapshot;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

type HistoryLine = ({ kind: "reading" } & SensorReading) | ({ kind: "emptying" } & Emptying);

/** Append-only JSONL file with an in-memory index loaded at start. */
export class JsonlHistory implements HistoryStore {
  private byBin = new Map<string, SensorReading[]>();
  private emptiedByBin = new Map<string, Emptying[]>();
  /** Lines in the file that could not be parsed when it was opened. */
  skippedLines = 0;

  private constructor(private path: string) {}

  static async open(path: string): Promise<JsonlHistory> {
    const h = new JsonlHistory(path);
    await mkdir(dirname(path), { recursive: true });
    let text = "";
    try {
      text = await readFile(path, "utf8");
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      // A process killed mid-append leaves a torn line. Skip it instead of refusing to start.
      let parsed: HistoryLine;
      try {
        parsed = JSON.parse(line) as HistoryLine;
      } catch {
        h.skippedLines += 1;
        continue;
      }
      const { kind, ...rest } = parsed;
      if (kind === "reading") h.index(rest as SensorReading);
      else h.indexEmptying(rest as Emptying);
    }
    return h;
  }

  private index(r: SensorReading) {
    const list = this.byBin.get(r.bin_id) ?? [];
    list.push(r);
    this.byBin.set(r.bin_id, list);
  }

  private indexEmptying(e: Emptying) {
    const list = this.emptiedByBin.get(e.bin_id) ?? [];
    list.push(e);
    this.emptiedByBin.set(e.bin_id, list);
  }

  async appendReading(reading: SensorReading): Promise<void> {
    this.index(reading);
    await this.write({ kind: "reading", ...reading });
  }

  async appendEmptying(e: Emptying): Promise<void> {
    this.indexEmptying(e);
    await this.write({ kind: "emptying", ...e });
  }

  /** One append at a time: overlapping appends tear lines on bind-mounted volumes. */
  private tail: Promise<void> = Promise.resolve();
  private write(line: HistoryLine): Promise<void> {
    const next = this.tail.then(() => appendFile(this.path, JSON.stringify(line) + "\n"));
    this.tail = next.catch(() => undefined);
    return next;
  }

  readings(binId: string, sinceIso?: string): SensorReading[] {
    const all = this.byBin.get(binId) ?? [];
    return sinceIso ? all.filter((r) => r.timestamp >= sinceIso) : all;
  }

  emptyings(binId: string): Emptying[] {
    return this.emptiedByBin.get(binId) ?? [];
  }
}
