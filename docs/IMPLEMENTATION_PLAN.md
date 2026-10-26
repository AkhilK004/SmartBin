# SmartBin Gwalior — Phase-wise Implementation Plan

Source: `CLAUDE.md`. Section references (§N) point to it. `SMARTBIN_prompt.md` was empty when this plan was written (2026-10-26).

**Cloud target changed to AWS (decision by the team, 2026-10-26).** `CLAUDE.md` §6, §9 and the Pub/Sub envelope rule still say Google Cloud. Because `CLAUDE.md` wins over this plan, Phase 0 updates it first. Until then, treat the AWS parts of this plan as pending.

Ground rules for every phase:
- Build only what `CLAUDE.md` lists as Core. No extra libraries, services or abstractions beyond the three adapter interfaces it requires.
- Finish, test and run one module before starting the next (§11.10).
- A phase is done only when its exit checks were actually run and passed.

---

## Repository layout (kept flat on purpose)

```
CC-project/
├── CLAUDE.md
├── docker-compose.yml          # osrm, optimizer, server, web
├── .env.example
├── docs/   IMPLEMENTATION_PLAN.md  ASSUMPTIONS.md  DEPLOY_AWS.md
├── shared/ schemas.md
├── osrm/   build.sh  README.md
├── optimizer/                  # Python 3.11, FastAPI, OR-Tools
│   ├── app/ main.py  models.py  settings.py  matrix.py  solver.py  baseline.py
│   └── tests/
├── server/                     # Node 20, TS, Express, Socket.io
│   ├── src/
│   │   ├── index.ts  config.ts
│   │   ├── adapters/  types.ts  local.ts  aws.ts      # 3 interfaces, local impl, AWS impl
│   │   ├── domain/    classify.ts  frequency.ts  dispatch.ts  savings.ts  alerts.ts
│   │   ├── seed.ts
│   │   ├── sim/       sensors.ts  trucks.ts
│   │   ├── routes.ts                                  # all HTTP endpoints
│   │   └── socket.ts
│   └── test/
└── web/                        # Vite, React 18, TS, Tailwind, maplibre-gl v4, Zustand
    └── src/ main.tsx  App.tsx  store.ts  socket.ts  MapView.tsx  panels/*.tsx
```

---

## Phase 0 — Foundation and contracts

1. **Update `CLAUDE.md` for AWS** (§6 table, §9 row, the "do not switch to AWS" line, the Pub/Sub envelope rule). Get the team's OK on the edit.
2. Init git, `.gitignore`, `.env.example` (`VITE_MAPTILER_KEY`, `OSRM_URL`, `OPTIMIZER_URL`, `STORE`, `BUS`, `HISTORY`, `SEED_BIN_COUNT`).
3. Write `shared/schemas.md` (§8), `snake_case`:
   - `SensorReading`: `bin_id, fill_pct, lat, lng, battery, temp_c, gas_ppm, timestamp`.
   - `Bin`, `Zone`, `Truck` (`kind`: `primary_compactor` | `secondary_autotipper`), depot, dump yard, `Plan` (incl. `decisions`, `skip_list`, `distance_source`), `Savings`, `Alert`.
   - Optimizer request/response.
   - Socket events: `state:init`, `bins:update`, `trucks:update` (1 s), `routes:update`, `plan:update`, `alerts:new`, `savings:update`.
   - HTTP: `POST /ingest/readings` (raw reading **or** SNS HTTP notification envelope), `POST /jobs/frequency`, `POST /jobs/daily`, `GET/PUT /settings`, `POST /sim/*`.
4. `server/src/config.ts`: every number from §4 and §10, each §10 value commented `// ASSUMPTION`. Mirror optimizer numbers in `optimizer/app/settings.py`.
5. `docs/ASSUMPTIONS.md` with the open items at the end of this plan.
6. Scaffolds: server (`vitest`), optimizer (`pytest`), web (Vite). `docker-compose.yml` with four services.

Exit: `server` and `web` build; `pytest` runs; schemas cover every item in §8.

---

## Phase 1 — Seed data and road network

1. `seed.ts`:
   - 6 zones (Maharaj Bada, Lashkar, City Centre, Thatipur, Morar, Hazira) as approximate polygons inside bbox `78.05,26.12,78.32,26.32`, each with a seed fill rate.
   - Depot and dump yard.
   - `SEED_BIN_COUNT` bins (default 60, about 10 per zone), seeded-random inside zone polygons, with a mix of `location_type`.
   - Fleet: primary compactors and secondary auto-tippers, counts from config.
   - All locations marked **approximate** (§10).
2. `osrm/build.sh`: Geofabrik India extract → `osmium extract` to the bbox → `osrm-extract` (car profile) → `osrm-partition` → `osrm-customize` → `osrm-routed --algorithm mld`. Run it as the `osrm` service on port 5000.

Exit:
- `curl` to OSRM `/table` and `/route` between depot and a bin returns real distances.
- Test: every seed bin lies inside its zone; `SEED_BIN_COUNT=150` also seeds correctly.

---

## Phase 2 — Server core

1. `adapters/types.ts`: `MessageBus`, `StateStore`, `HistoryStore` interfaces.
2. `adapters/local.ts`: `LocalBus` (EventEmitter), `MemoryStore` (+ JSON snapshot on interval and on shutdown, restore on start), JSONL history. Picked by env; local is the default.
3. `POST /ingest/readings`: zod validation; accepts a raw reading (or array) or an SNS envelope (`Type: "Notification"`, JSON in `Message`; answers `SubscriptionConfirmation` by fetching `SubscribeURL`). Publishes to the bus; a subscriber updates state and history.
4. `domain/alerts.ts`: overflow (fill ≥ 100), hazard, low battery, offline. Emit `alerts:new` once per state change.
5. `socket.ts`: `state:init` on connect (also covers reconnect); `bins:update` with changed bins only.

Exit (vitest): raw and SNS payloads update the same bin; bad payload → 400; restart restores snapshot; each alert fires once.

---

## Phase 3 — Business rules

1. `domain/classify.ts` (all thresholds from config):
   - hazard: gas > 400 ppm, temp > 55 °C, or citizen complaint.
   - `hours_to_full = (100 − fill) / max(rate, 0.01)`; `hours_left` = hours to zone's next collection; predicted overflow if `hours_to_full < hours_left`.
   - Class: must-visit (fill > 85, predicted overflow, or hazard); visit-if-nearby (40–85); skip (< 40).
   - Urgent: fill ≥ 95, predicted overflow, or hazard.
   - `OverflowRisk = clamp(100 × (1 − hours_to_full / hours_left), 0, 100)`.
   - `Priority = w1·Fill + w2·OverflowRisk + w3·LocationWeight`, weights normalised to 1; location weights from §4.
   - Colour: green, amber, red, purple (hazard), grey (offline).
2. `domain/frequency.ts`:
   - Zone rate = slope of fill since last emptying from history; seed rate when history is too short.
   - `days_to_85 = (85 − 10) / rate_pct_per_day` → daily / every 2 days / every 3 days / twice a week.
   - 14-day collection calendar per zone.

Exit (vitest): boundary tests at 39.9 / 40 / 85 / 85.1 / 95 and each hazard trigger; weight normalisation; each frequency band; seed fallback.

---

## Phase 4 — Optimizer (Python)

1. `models.py`: Pydantic v2 request (depot, dump yard, vehicles, stops with `demand_kg`, `mandatory`, `priority`, `penalty_scale`) and response (ordered stops incl. dump visits, `distance_m`, `duration_s`, `dropped`, `distance_source`, `decisions`).
2. `matrix.py`: OSRM `/table` via `httpx`; on failure, haversine with `distance_source: "haversine_fallback"`.
3. `solver.py`, OR-Tools, `cvrp_reload` pattern:
   - Duplicated dump-yard nodes with demand −capacity, optional with penalty 0, capacity slack reset only there.
   - Arc cost = road metres.
   - Must-visit: no disjunction. Visit-if-nearby: `AddDisjunction([index], round(priority × penalty_scale))`. Skip bins are never sent.
   - Time: 22 km/h travel + 60 s per bin.
   - `GUIDED_LOCAL_SEARCH` with a time limit from settings.
   - If must-visit bins cannot all fit, return an explicit error. Never drop them silently.
4. `baseline.py`: every bin of the due zones mandatory, street order (open item B), same capacity and dump rules.
5. Endpoints: `GET /health`, `POST /optimize`, `POST /baseline`.

Exit (pytest):
- Far 50% bin dropped while a near one is kept.
- Must-visit always kept.
- Capacity never exceeded; dump visit appears when needed.
- Higher priority or `penalty_scale` brings a dropped bin back.
- Fallback sets the label.
- 150 bins solve within the time limit.

---

## Phase 5 — Daily plan and dispatch

`domain/dispatch.ts`, run by `POST /jobs/daily`:

1. Classify all bins.
2. Due zones = zones whose calendar day is today. Primary trucks run only for them.
3. If a due zone's expected load is under 40% of one primary truck's capacity, defer it to its next day.
4. Remaining due zones → optimizer with must-visit + visit-if-nearby bins on primary trucks. Skip bins → skip list.
5. Non-due zones:
   - urgent bins go to secondary trucks;
   - standard 85–95% bins with no overflow prediction and no hazard wait for their zone's day.
6. Call `/baseline` for the due zones.
7. Save the plan. Every deferral, drop, skip, wait and dispatch adds a readable string to `plan.decisions`. Emit `plan:update` and `routes:update`.

`POST /jobs/frequency` recalculates rates and the calendar. `node-cron` calls both endpoints over HTTP (the same call EventBridge makes on AWS).

Exit (vitest):
- Single 88% bin in a non-due zone → no dispatch.
- Lone 96% bin in a non-due zone → secondary truck, never primary.
- Under-load zone deferred.
- Skip bins never in any route.
- Every outcome has a decision string.
- Changing priority weights via `/settings` changes the dropped bins (runs against the optimizer service).

---

## Phase 6 — Simulators

1. `sim/sensors.ts`:
   - fill grows by `location_type` rate with noise; battery drains;
   - occasional gas or temperature spikes and offline bins;
   - readings go through `/ingest/readings`.
2. Manual controls (`/sim/*`): set a bin's fill/gas/temp, raise a citizen complaint, toggle offline, set time speed (1× / 60× / 600×), run the daily plan now.
3. `sim/trucks.ts`:
   - trucks follow OSRM `/route` geometry at 22 km/h × time speed, with 60 s per bin;
   - a collected bin is set to 0 % and the emptying is recorded;
   - a full truck visits the dump yard, then continues;
   - trucks return to the depot at the end;
   - `trucks:update` every 1 s.
4. Overflows missed:
   - count bins that reach 100% before they are collected;
   - count the same for the baseline schedule (open item C).

Exit: one simulated day at 60× runs start to finish. Collected bins drop to 0, load never exceeds capacity, and dump visits happen when needed.

---

## Phase 7 — Savings

`domain/savings.ts`:
- Measures, each as baseline vs optimized: stops, km, fuel and overflows missed. Fuel uses 0.35 / 0.12 L/km and is labelled **estimate**.
- Daily and running totals; emit `savings:update`.
- No hardcoded target numbers.

Exit: unit test on a fixture plan; baseline stops equal all bins in due zones.

---

## Phase 8 — Web dashboard

1. Zustand store fed by `socket.io-client`.
2. `MapView.tsx`:
   - `maplibre-gl` v4 with a MapTiler vector style and terrain-RGB, pitch 60, 3D buildings;
   - without a key, use OpenFreeMap and show a "no terrain" note;
   - layers: zones, colour-coded bins, depot, dump yard, route lines per truck, moving trucks;
   - a bin popup shows fill, battery, temp, gas, class and priority.
3. Panels (`lucide-react` icons, `recharts` for savings):
   - **Legend:** colours, truck kinds, "locations approximate".
   - **Plan:** due and deferred zones, stops per truck, `decisions` verbatim, and a visible badge when `haversine_fallback` is in use.
   - **Skip list:** per zone.
   - **Calendar:** 14 days per zone, with the current interval.
   - **Alerts:** overflow, hazard, low battery, offline.
   - **Savings:** baseline vs optimized; fuel marked "estimate"; footer "computed from simulated data".
   - **Settings:** priority weights (shown normalised), `penalty_scale`, hazard and fill thresholds; re-run the plan.
   - **Simulator:** the Phase 6 controls.

Exit (manual run, with and without a MapTiler key):
- Setting a non-due bin to 96% shows a secondary route.
- Changing the weights changes the dropped bins on the map.
- Trucks move live.

---

## Phase 9 — Integration and demo

1. Dockerfiles for server, optimizer and web; `docker compose up` starts all four.
2. Demo script: seed → `/jobs/frequency` → `/jobs/daily` → trucks run at 60× → savings update.
3. Check failures:
   - optimizer down → plan shows the error;
   - OSRM down → fallback label shows;
   - browser reload → state returns.
4. README: run steps and demo script. Walk the §13 checklist for every feature.

Exit: fresh clone → `docker compose up` → full demo day; all vitest and pytest suites green.

---

## Phase 10 — AWS readiness (written and documented, not on by default)

| Concern | Local | AWS |
|---|---|---|
| Message bus | `LocalBus` | SNS topic `bin-readings`, HTTPS subscription → `/ingest/readings` |
| Live state | `MemoryStore` + JSON snapshot | DynamoDB table `smartbin_state` |
| History | JSONL | DynamoDB table `bin_readings` (PK `bin_id`, SK `timestamp`) |
| Scheduled jobs | `node-cron` | EventBridge Scheduler/rule with API destination → `POST /jobs/*` |
| Services | Docker Compose | the same Compose file on one EC2 instance (Socket.io and OSRM run unchanged) |
| Secrets | `.env` | SSM Parameter Store (SecureString) |

1. `adapters/aws.ts`: `SnsBus`, `DynamoStore`, `DynamoHistory`, using AWS SDK v3. Chosen only by env (`BUS=sns`, `STORE=dynamodb`, `HISTORY=dynamodb`). `domain/` never imports it.
2. `docs/DEPLOY_AWS.md`: create the resources, IAM role for EC2, scheduler setup, Parameter Store keys.

Exit: local build and tests still pass with `aws.ts` present but unused.

---

## Phase 11 — Stretch (only after core passes, and only if asked)

Time windows, live traffic, ML fill forecasting, Telegram/email alerts, driver PWA, citizen photo reports. Each one replaces a Google service named in `CLAUDE.md` §5 with an AWS service. Pick that service only when the feature is requested.

---

## Coverage check

### Invariants (§3) → where they are enforced and tested

| # | Invariant | Phase / test |
|---|---|---|
| 1 | No trip for a single standard bin | 5 — 88% non-due bin test |
| 2 | Planned days only | 5 — primaries only on due zones |
| 3 | Minimum load check | 5 — under-load deferral test |
| 4 | Lone urgent bin → secondary | 5 — 96% bin test |
| 5 | Must-visit never dropped | 4 — mandatory node test |
| 6 | Skip means skip | 5 — skip bins never in routes |
| 7 | Capacity never exceeded | 4 — dump visit test; 6 — sim assertion |
| 8 | Real road distances | 1 — OSRM; 4 — fallback label test; 8 — UI badge |
| 9 | Every decision explained | 5 — decision string test; 8 — Plan panel |
| 10 | No hardcoded thresholds | 0 — `config.ts`; test greps `domain/` for numeric literals from §4 |
| 11 | No cloud SDK in business logic | 10 — test fails if `domain/` imports `@aws-sdk` |

### Core features (§5) → phase

| Feature | Phase |
|---|---|
| Live colour-coded 3D bin map | 8 |
| Frequency Planner + collection calendar | 3, 8 |
| Daily plan with dispatch checks | 5 |
| OR-Tools routing with optional stops | 4 |
| Multiple trucks driving routes live | 6, 8 |
| Manual sensor simulator | 6, 8 |
| Skip list | 5, 8 |
| Savings panel (stops, km, fuel estimate, overflows missed) | 7, 8 |
| Overflow, hazard, low-battery, offline alerts | 2, 8 |
| Configurable weights and `penalty_scale` | 3, 4, 8 |
| Scale to 150+ bins | 1, 4 |
| Assumptions and fallback shown honestly in UI | 8 |

---

## Open items (log in `docs/ASSUMPTIONS.md`)

- **A. Bin capacity in kg**
  - Needed for load estimates and VRP demand.
  - Proposed: `bin_capacity_kg` in config, labelled assumption.
- **B. "Street order" for the fixed baseline**
  - Proposed: nearest-neighbour order from the depot over OSRM distances.
- **C. Overflows missed for the baseline**
  - Proposed: replay the baseline schedule against the same simulated fill curves.
- **D. Fleet size**
  - Proposed: 3 primary, 2 secondary, in config.
- **E. Low-battery and offline thresholds**
  - Proposed: battery < 20%; offline after 3 missed reporting intervals.
- **F. First collection day per zone**
  - Proposed: staggered start dates, so not every zone is due on day 1.
- **G. Missing source files**
  - `docs/Smart_Waste_Route_Optimizer_Idea.pdf` and `docs/proposal.md` are referenced but not in the repo.
  - `SMARTBIN_prompt.md` is empty.
