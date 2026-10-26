// Interfaces business logic depends on (CLAUDE.md §6). Implementations: local.ts now, aws.ts in Phase 10.

import type { Alert, BinBase, Plan, SensorReading, Site, Truck, Zone } from "../types.js";

export interface MessageBus {
  publish(reading: SensorReading): Promise<void>;
  subscribe(handler: (reading: SensorReading) => void | Promise<void>): void;
}

export interface Snapshot {
  bins: BinBase[];
  zones: Zone[];
  trucks: Truck[];
  sites: Site[];
  alerts: Alert[];
  plan?: Plan | null;
}

export interface StateStore {
  getBins(): BinBase[];
  getBin(binId: string): BinBase | undefined;
  upsertBin(bin: BinBase): void;
  getZones(): Zone[];
  setZones(zones: Zone[]): void;
  getTrucks(): Truck[];
  setTrucks(trucks: Truck[]): void;
  getSites(): Site[];
  getAlerts(): Alert[];
  addAlert(alert: Alert): void;
  getPlan(): Plan | null;
  setPlan(plan: Plan): void;
  snapshot(): Snapshot;
  restore(snapshot: Snapshot): void;
}

export interface Emptying {
  bin_id: string;
  at: string;
}

export interface HistoryStore {
  appendReading(reading: SensorReading): Promise<void>;
  appendEmptying(emptying: Emptying): Promise<void>;
  readings(binId: string, sinceIso?: string): SensorReading[];
  emptyings(binId: string): Emptying[];
}
