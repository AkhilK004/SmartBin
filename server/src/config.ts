// All business thresholds and fixed numbers live here (CLAUDE.md §3.10).
// Values marked ASSUMPTION are not real data (CLAUDE.md §10): label them in the UI.

import type { LocationType, TruckKind } from "./types.js";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  osrmUrl: env.OSRM_URL ?? "http://localhost:5000",
  optimizerUrl: env.OPTIMIZER_URL ?? "http://localhost:8000",

  // Adapter selection (CLAUDE.md §6)
  bus: (env.BUS ?? "local") as "local" | "sns",
  store: (env.STORE ?? "local") as "local" | "dynamodb",
  history: (env.HISTORY ?? "local") as "local" | "dynamodb",
  snapshotPath: env.SNAPSHOT_PATH ?? "./data/snapshot.json",
  historyPath: env.HISTORY_PATH ?? "./data/history.jsonl",
  snapshotIntervalMs: 30_000,

  // ASSUMPTION: demo size; design must scale to 150+ (CLAUDE.md §9)
  seedBinCount: Number(env.SEED_BIN_COUNT ?? 60),

  // Bin classification (CLAUDE.md §4)
  thresholds: {
    skipBelowPct: 40,
    mustVisitAbovePct: 85,
    urgentAtPct: 95,
    overflowPct: 100,
    gasPpmHazard: 400,
    tempCHazard: 55,
  },

  // Priority = w.fill*Fill + w.overflowRisk*OverflowRisk + w.location*LocationWeight (normalised at use)
  priorityWeights: { fill: 0.5, overflowRisk: 0.3, location: 0.2 },

  locationWeight: {
    market: 100,
    hospital: 90,
    bus_stand: 85,
    school: 80,
    commercial: 60,
    residential: 40,
    park: 30,
  } satisfies Record<LocationType, number>,

  // Optimizer objective (CLAUDE.md §4)
  penaltyScale: 60,
  optimizerTimeLimitS: 10,

  // Haversine fallback only: straight-line metres times this approximates roads
  haversineRoadFactor: 1.4,
  osrmTimeoutMs: 10_000,

  // Dispatch (CLAUDE.md §3.3)
  minLoadFractionOfPrimary: 0.4,

  // Frequency Planner (CLAUDE.md §4)
  frequency: {
    startPct: 10,
    targetPct: 85,
    dailyBelowDays: 1.5,
    every2BelowDays: 2.5,
    every3BelowDays: 3.5,
    twiceAWeekIntervalDays: 3.5,
    // ASSUMPTION: twice a week = Monday and Thursday (0 = Sunday)
    twiceAWeekDays: [1, 4],
    calendarDays: 14,
    minHistoryHours: 12,
    minBinsForRate: 3,
  },

  // ASSUMPTION (CLAUDE.md §10): fleet
  fleet: {
    primaryCount: 3,
    secondaryCount: 2,
    capacityKg: { primary_compactor: 6000, secondary_autotipper: 800 } satisfies Record<TruckKind, number>,
  },

  // ASSUMPTION (CLAUDE.md §10): driving and service
  truckSpeedKmh: 22,
  serviceSecondsPerBin: 60,
  unloadSeconds: 300,

  // ASSUMPTION (CLAUDE.md §10): fuel factors, estimates only
  fuelLPerKm: { primary_compactor: 0.35, secondary_autotipper: 0.12 } satisfies Record<TruckKind, number>,

  // ASSUMPTION: bin capacity in kg, used for load and VRP demand (open item A)
  binCapacityKg: 120,

  // ASSUMPTION (CLAUDE.md §10): fill rate % per hour by location type
  fillRatePctPerHour: {
    market: 3.0,
    hospital: 2.0,
    bus_stand: 2.5,
    school: 1.5,
    commercial: 2.2,
    residential: 1.2,
    park: 0.8,
  } satisfies Record<LocationType, number>,

  // Alerts (open item E; ASSUMPTION)
  alerts: {
    lowBatteryPct: 20,
    offlineAfterMissedIntervals: 3,
    readingIntervalS: 60,
    maxAlertsKept: 200,
  },

  // Ingest and realtime
  ingestMaxBatch: 1000,
  binsFlushMs: 1000,
  trucksEmitMs: 1000,

  // Simulated time multipliers allowed by /sim/speed
  simSpeeds: [1, 60, 600] as const,

  // Gwalior OSM bbox (CLAUDE.md §7): minLng, minLat, maxLng, maxLat
  bbox: [78.05, 26.12, 78.32, 26.32] as const,
  timezone: "Asia/Kolkata",
  utcOffsetMinutes: 330,
  // ASSUMPTION: collection runs start at 06:00 local time
  collectionStartHour: 6,
} as const;

export type Config = typeof config;
