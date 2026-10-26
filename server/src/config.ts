// All business thresholds and fixed numbers live here (CLAUDE.md §3.10).
// Values marked ASSUMPTION are not real data (CLAUDE.md §10): label them in the UI.

import type { LocationType, TruckKind } from "./types.js";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  osrmUrl: env.OSRM_URL ?? "http://127.0.0.1:5000",
  optimizerUrl: env.OPTIMIZER_URL ?? "http://127.0.0.1:8001",

  // Adapter selection (CLAUDE.md §6)
  bus: (env.BUS ?? "local") as "local" | "sns",
  store: (env.STORE ?? "local") as "local" | "dynamodb",
  history: (env.HISTORY ?? "local") as "local" | "dynamodb",
  snapshotPath: env.SNAPSHOT_PATH ?? "./data/snapshot.json",
  historyPath: env.HISTORY_PATH ?? "./data/history.jsonl",
  snapshotIntervalMs: 30_000,

  // ASSUMPTION: demo size, about 45 bins per zone x 6 zones; design must scale to 150+ (CLAUDE.md §9)
  seedBinCount: Number(env.SEED_BIN_COUNT ?? 270),

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
  optimizerTimeoutMs: 60_000,

  // Haversine fallback only: straight-line metres times this approximates roads
  haversineRoadFactor: 1.4,
  osrmTimeoutMs: 10_000,

  // Dispatch (CLAUDE.md §3.3)
  minLoadFractionOfPrimary: 0.4,
  // Urgent override: a due zone below the minimum load still gets a primary run when it holds
  // at least this many urgent bins; secondary trucks take at most this many minus one per zone.
  urgentOverrideCount: 3,
  maxSecondaryUrgentPerZone: 2,

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

  // Scheduled jobs (CLAUDE.md §6): node-cron locally, EventBridge Scheduler on AWS; both POST /jobs/*
  cron: { frequency: "0 0 * * *", daily: "30 0 * * *" },

  // ASSUMPTION: simulator behaviour (invented, not data)
  sim: {
    enabled: (env.SIM ?? "on") !== "off",
    seed: 20261027,
    tickMs: 1000,
    maxStepS: 30,
    fillNoise: 0.2, // fill growth is rate * (1 +/- fillNoise)
    readingJitterS: 60,
    batteryDrainPctPerDay: [0.5, 3] as const,
    gasSpikePerBinPerHour: 0.002,
    gasSpikeAddPpm: [350, 600] as const,
    tempSpikePerBinPerHour: 0.0005,
    tempSpikeAddC: [28, 40] as const,
    spikeDurationH: [2, 4] as const,
    offlinePerBinPerHour: 0.001,
    offlineDurationH: [1, 3] as const,
    gasNoisePpm: 10,
    tempNoiseC: 1,
  },

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
