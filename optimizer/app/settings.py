"""Optimizer numbers. Mirror of server/src/config.ts; keep both in sync (CLAUDE.md §3.10).

Values marked ASSUMPTION are not real data (CLAUDE.md §10).
"""
import os

OSRM_URL = os.getenv("OSRM_URL", "http://localhost:5000")

# Optimizer objective (CLAUDE.md §4): drop penalty = round(priority * PENALTY_SCALE)
PENALTY_SCALE = 60
TIME_LIMIT_S = 10

# ASSUMPTION (CLAUDE.md §10)
TRUCK_SPEED_KMH = 22
SERVICE_SECONDS_PER_BIN = 60
UNLOAD_SECONDS = 300
# ASSUMPTION: one shift is 8 h of driving, service and unloading, depot to depot
SHIFT_SECONDS = 8 * 3600

# Haversine fallback only: straight-line distance times this factor approximates roads
HAVERSINE_ROAD_FACTOR = 1.4
OSRM_TIMEOUT_S = 10
