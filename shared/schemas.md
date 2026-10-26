# shared/schemas.md — data contracts

Single reference for every payload (CLAUDE.md §8). Change a contract here first, then in code and tests.

Conventions
- Field names are `snake_case` on the wire.
- `timestamp`, `*_at`: ISO 8601 UTC string, e.g. `2026-10-26T09:30:00Z`.
- `date`: `YYYY-MM-DD` in local Gwalior time (Asia/Kolkata).
- Percentages are numbers 0–100. Distances: metres (`*_m`) or kilometres (`*_km`) as named. Mass: kg.
- Coordinates: `lat`, `lng` (WGS84).
- Values marked **approximate** or **estimate** are assumptions (CLAUDE.md §10) and must be labelled in the UI.

---

## Enums

| Name | Values |
|---|---|
| `location_type` | `market`, `hospital`, `bus_stand`, `school`, `commercial`, `residential`, `park` |
| `bin_class` | `must_visit`, `visit_if_nearby`, `skip` |
| `bin_color` | `green`, `amber`, `red`, `purple`, `grey` |
| `bin_status` | `online`, `offline` |
| `truck_kind` | `primary_compactor`, `secondary_autotipper` |
| `truck_status` | `idle`, `driving`, `servicing`, `to_dump_yard`, `unloading`, `returning` |
| `alert_type` | `overflow`, `hazard`, `low_battery`, `offline` |
| `distance_source` | `osrm`, `haversine_fallback` |
| `interval_label` | `daily`, `every_2_days`, `every_3_days`, `twice_a_week` |

---

## SensorReading (also what a future ESP32 sends)

```json
{
  "bin_id": "B-001",
  "fill_pct": 62.5,
  "lat": 26.2183,
  "lng": 78.1828,
  "battery": 87,
  "temp_c": 31.2,
  "gas_ppm": 120,
  "timestamp": "2026-10-26T09:30:00Z"
}
```

All fields required. `fill_pct` 0–100, `battery` 0–100, `gas_ppm` ≥ 0.

---

## Bin

```json
{
  "bin_id": "B-001",
  "zone_id": "lashkar",
  "location_type": "market",
  "lat": 26.2183,
  "lng": 78.1828,
  "fill_pct": 62.5,
  "fill_rate_pct_per_hour": 2.1,
  "battery": 87,
  "temp_c": 31.2,
  "gas_ppm": 120,
  "complaint": false,
  "status": "online",
  "last_seen": "2026-10-26T09:30:00Z",
  "last_emptied": "2026-10-25T06:10:00Z",

  "hazard": false,
  "urgent": false,
  "predicted_overflow": false,
  "hours_to_full": 17.9,
  "overflow_risk": 12.0,
  "priority": 58.4,
  "bin_class": "visit_if_nearby",
  "color": "amber"
}
```

Fields from `hazard` down are derived by the server (never sent by a sensor). `lat`/`lng` are **approximate** seed positions.

---

## Zone

```json
{
  "zone_id": "lashkar",
  "name": "Lashkar",
  "polygon": [[78.15, 26.20], [78.20, 26.20], [78.20, 26.24], [78.15, 26.24]],
  "fill_rate_pct_per_day": 38.0,
  "days_to_85": 1.97,
  "interval_days": 2,
  "interval_label": "every_2_days",
  "last_collection_date": "2026-10-25",
  "next_collection_date": "2026-10-27",
  "calendar": ["2026-10-27", "2026-10-29", "2026-10-31"]
}
```

`next_collection_date` is the first `calendar` date on or after today. `interval_days` is `3.5` for `twice_a_week` (average); that calendar uses fixed weekdays Monday and Thursday. `hours_left` for a bin = hours from now until 06:00 local on the first `calendar` date **after** today (on a due day, the collection after today's). `polygon` is `[lng, lat]` pairs (GeoJSON order), first point not repeated. Zone ids: `maharaj_bada`, `lashkar`, `city_centre`, `thatipur`, `morar`, `hazira`. `calendar` covers the next 14 days. Boundaries are **approximate**.

---

## Site (depot, dump yard)

```json
{ "site_id": "depot", "kind": "depot", "name": "Main Depot", "lat": 26.2, "lng": 78.17 }
```

`kind` is `depot` or `dump_yard`. Locations are **approximate**.

---

## Truck

```json
{
  "truck_id": "T-P1",
  "kind": "primary_compactor",
  "capacity_kg": 6000,
  "load_kg": 1840,
  "lat": 26.2101,
  "lng": 78.1760,
  "heading_deg": 135,
  "status": "driving",
  "route_id": "R-2026-10-27-T-P1",
  "next_stop_bin_id": "B-014"
}
```

`route_id` and `next_stop_bin_id` are `null` when idle.

---

## Optimizer API (server → optimizer service)

### POST /optimize

Request
```json
{
  "depot": { "lat": 26.2, "lng": 78.17 },
  "dump_yard": { "lat": 26.19, "lng": 78.2 },
  "vehicles": [
    { "vehicle_id": "T-P1", "kind": "primary_compactor", "capacity_kg": 6000 }
  ],
  "stops": [
    {
      "bin_id": "B-001", "lat": 26.2183, "lng": 78.1828,
      "demand_kg": 74, "mandatory": true, "priority": 91.0
    }
  ],
  "penalty_scale": 60,
  "time_limit_s": 10,
  "shift_limit_s": 28800
}
```

`shift_limit_s` is optional (default 8 h, an assumption): the maximum duration of one vehicle's route, depot to depot, including service time. `mandatory: true` = must-visit (no disjunction). `mandatory: false` = optional stop with drop penalty `round(priority × penalty_scale)`. Skip bins are never sent.

Response
```json
{
  "routes": [
    {
      "vehicle_id": "T-P1",
      "stops": [
        { "type": "bin", "bin_id": "B-001", "lat": 26.2183, "lng": 78.1828, "load_after_kg": 74 },
        { "type": "dump_yard", "lat": 26.19, "lng": 78.2, "load_after_kg": 0 }
      ],
      "distance_m": 12840,
      "duration_s": 3120
    }
  ],
  "dropped": [
    { "bin_id": "B-009", "reason": "detour 4.1 km outweighs priority value 3.2 km" }
  ],
  "distance_source": "osrm",
  "decisions": ["B-009 dropped: ..."]
}
```

Routes start and end at the depot implicitly (depot is not listed in `stops`). An infeasible must-visit set returns HTTP 422 with `{ "error": "infeasible", "detail": "..." }`; must-visit bins are never silently dropped.

### POST /baseline

Same request shape; every stop is treated as mandatory and ordered in street order. Response shape is identical to `/optimize` (`dropped` is always empty).

### GET /health

`{ "status": "ok" }`

---

## Plan

```json
{
  "date": "2026-10-27",
  "generated_at": "2026-10-27T00:30:00Z",
  "due_zones": ["lashkar"],
  "urgent_override_zones": [],
  "deferred_zones": [
    { "zone_id": "morar", "expected_load_kg": 1920, "min_load_kg": 2400, "next_collection_date": "2026-10-29" }
  ],
  "routes": [
    {
      "route_id": "R-2026-10-27-T-P1",
      "truck_id": "T-P1",
      "truck_kind": "primary_compactor",
      "stops": [ { "type": "bin", "bin_id": "B-001", "lat": 26.2183, "lng": 78.1828, "load_after_kg": 74 } ],
      "distance_m": 12840,
      "duration_s": 3120,
      "geometry": [[78.17, 26.2], [78.1828, 26.2183]],
      "leg_distances_m": [1573, 1573]
    }
  ],
  "skip_list": [ { "bin_id": "B-020", "zone_id": "lashkar", "fill_pct": 22.0 } ],
  "dropped_optional": [ { "bin_id": "B-009", "reason": "..." } ],
  "waiting": [ { "bin_id": "B-033", "zone_id": "morar", "fill_pct": 88.0, "reason": "standard bin, waits for zone day 2026-10-29" } ],
  "distance_source": "osrm",
  "baseline": { "stops": 40, "distance_m": 32100, "duration_s": 14400, "vehicles_used": 2 },
  "decisions": ["Zone Morar deferred: expected load 1920 kg < 2400 kg (40% of 6000 kg)"],
  "error": null
}
```

`geometry` is a `[lng, lat]` polyline along roads (from OSRM `/route`). `leg_distances_m` has one road distance per leg (depot to stop 1, ..., last stop to depot; length = stops + 1); the truck simulator uses it to place the stops along the geometry. `due_zones` lists every zone whose collection day is today (CLAUDE.md glossary), deferred ones included; `deferred_zones` is the subset skipped for low load. `urgent_override_zones` lists due zones below the minimum load that still got a primary run because they hold 3 or more urgent bins (they appear in neither `deferred_zones` nor the secondary routes). Secondary trucks take at most 2 urgent bins per zone, highest priority first; further urgent bins in a zone that is not due appear in `waiting` with a decision. `baseline` is the fixed-route comparison over every bin of all due zones (null if unavailable). `distance_source` is `null` when no route was computed, and `haversine_fallback` if any route used it. `waiting` holds must-visit bins that wait for their zone's day (standard bins), or urgent bins with no secondary truck. `error` is a string if the optimizer failed (the plan then has empty `routes`). `decisions` is the readable log required by CLAUDE.md §3.9.

---

## Savings

```json
{
  "date": "2026-10-27",
  "stops":   { "baseline": 40, "optimized": 18 },
  "km":      { "baseline": 32.1, "optimized": 13.4 },
  "fuel_l":  { "baseline": 11.2, "optimized": 4.7 },
  "overflows_missed": { "baseline": 3, "optimized": 0 },
  "fuel_is_estimate": true,
  "simulated": true,
  "cumulative": {
    "stops": { "baseline": 40, "optimized": 18 },
    "km": { "baseline": 32.1, "optimized": 13.4 },
    "fuel_l": { "baseline": 11.2, "optimized": 4.7 },
    "overflows_missed": { "baseline": 3, "optimized": 0 }
  }
}
```

The numbers above are examples of shape only. Real values are computed from simulated data (CLAUDE.md §10).

---

## Alert

```json
{
  "alert_id": "A-000123",
  "type": "hazard",
  "bin_id": "B-014",
  "message": "B-014 gas 460 ppm > 400 ppm",
  "timestamp": "2026-10-26T09:31:00Z"
}
```

---

## Settings

```json
{
  "priority_weights": { "fill": 0.5, "overflow_risk": 0.3, "location": 0.2 },
  "penalty_scale": 60,
  "thresholds": {
    "skip_below_pct": 40,
    "must_visit_above_pct": 85,
    "urgent_at_pct": 95,
    "gas_ppm_hazard": 400,
    "temp_c_hazard": 55
  }
}
```

`GET /settings` returns the current values (weights are returned normalised to sum 1). `PUT /settings` accepts any subset and returns the new settings; unknown keys, negative values, all-zero weights, or thresholds not satisfying `skip_below_pct <= must_visit_above_pct <= urgent_at_pct` → 400.

---

## HTTP endpoints (server)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/ingest/readings` | `SensorReading`, array of them, or SNS envelope | 202 on accept, 400 on invalid |
| POST | `/jobs/frequency` | none | recompute zone rates from history and rebuild calendars; returns `Zone[]` |
| POST | `/jobs/daily` | none | roll calendars to today, build and publish the daily plan; 200 with the `Plan`, 502 with the `Plan` (its `error` set) if the optimizer failed |
| GET | `/state` | none | full snapshot (same payload as `state:init`) |
| GET | `/settings` | none | see Settings |
| PUT | `/settings` | partial Settings | triggers re-plan on next `/jobs/daily` |
| GET | `/sim` | none | `{ speed, now, overflows_missed: { by_date: { "YYYY-MM-DD": { baseline, optimized } }, total: { baseline, optimized } } }` |
| POST | `/sim/bin` | `{ "bin_id", "fill_pct"?, "gas_ppm"?, "temp_c"?, "complaint"?, "offline"? }` (at least one besides `bin_id`) | manual override; returns the updated `Bin`; 404 unknown bin, 400 invalid |
| POST | `/sim/speed` | `{ "speed": 1 \| 60 \| 600 }` | simulated time multiplier; returns the sim status; 400 otherwise |

`/sim/*` answer 503 when the simulator is off (`SIM=off`). `POST /jobs/daily` is also the "run the daily plan now" control.
| GET | `/health` | none | `{ "status": "ok" }` |

SNS envelope (`BUS=sns`): `{ "Type": "Notification", "Message": "<SensorReading JSON string>", ... }`. For `Type: "SubscriptionConfirmation"` the server fetches `SubscribeURL`.

---

## Socket.io events (server → web)

| Event | Payload | Cadence |
|---|---|---|
| `state:init` | `{ bins: Bin[], zones: Zone[], trucks: Truck[], sites: Site[], plan: Plan \| null, savings: Savings \| null, alerts: Alert[], settings: Settings, sim: { speed: number, now: string } }` | on connect |
| `bins:update` | `Bin[]` (changed bins only) | on change, batched ≤ 1 s |
| `trucks:update` | `Truck[]` | every 1 s (real time) |
| `sim:update` | `{ speed: number, now: string }` | every 1 s (real time) |
| `routes:update` | `Plan["routes"]` | when a plan is built |
| `plan:update` | `Plan` | when a plan is built |
| `alerts:new` | `Alert` | once per alert |
| `savings:update` | `Savings` | after each plan and at end of day |
