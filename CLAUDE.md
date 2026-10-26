# CLAUDE.md — SmartBin Gwalior (project source of truth)

Read this file at the start of every session and before every non-trivial change. If a request, a file in the repo, or your own memory conflicts with this file, **this file wins**. If this file is silent or ambiguous, **ask, or record an assumption in `docs/ASSUMPTIONS.md`**. Do not invent.

---

## 1. What we are building

An IoT smart-waste system for **Gwalior, Madhya Pradesh, India**. It is the BCS VII Cloud Computing group project, Topic 2: *IoT Smart Waste Management & Route Optimizer*.

Smart bins report fill level, GPS and battery. The system:

1. learns how fast each zone fills and sets how often it is collected (Frequency Planner);
2. on each zone's collection day, decides which bins to collect, which to skip, and which are urgent (Daily Collection Plan);
3. builds the shortest practical route over the selected bins with OR-Tools over real OSRM road distances (Route Optimizer);
4. shows bins, trucks and routes live on a professional **3D map dashboard**, with a savings panel comparing the fixed route against the optimized one.

**The core idea, in one sentence:** reduce the stops and kilometres on trips that already happen, and never create an extra trip. Fuel use can only go down.

---

## 2. Source-of-truth order

When two sources disagree, the higher one wins:

1. **This file.**
2. `docs/Smart_Waste_Route_Optimizer_Idea.pdf` (the original project design), except where §9 lists a deliberate deviation.
3. `docs/proposal.md` (the project proposal).
4. `shared/schemas.md` (data contracts).
5. Everything else, including your own assumptions.

Never "improve" a business rule because it seems more sensible. If you think a rule is wrong, say so in your reply and keep implementing the rule as written until the user changes this file.

---

## 3. Invariants (never violate; test them)

1. **No trip for a single standard bin.** A truck is never dispatched because one bin with fill 85–95%, no overflow prediction and no hazard is full. It waits for its zone's scheduled day.
2. **Planned days only.** Primary trucks run only on collection days set by the Frequency Planner.
3. **Minimum load check.** If a due zone's expected load is under **40% of one primary truck's capacity**, defer the zone to its next collection day. **Urgent override:** if that zone holds **3 or more urgent bins**, skip the deferral and send the primary truck.
4. **Lone urgent bin → secondary truck.** An urgent bin in a zone with no run today goes to the small auto-tipper / e-rickshaw, never to a primary compactor. Secondary trucks take **at most 2 urgent bins per zone**; any further urgent bins in a zone that is not due wait for its collection day and are logged in `plan.decisions`.
5. **Must-visit is never dropped.** A must-visit bin is a mandatory node (no disjunction) in the VRP.
6. **Skip means skip.** A bin under 40% is never in a route. It appears on the driver's skip list.
7. **Capacity is never exceeded.** A full truck goes to the dump yard and continues.
8. **Real road distances.** Use OSRM, not straight lines. Haversine is allowed only as a clearly labelled fallback (`distance_source: "haversine_fallback"`, shown in the UI).
9. **Every dispatch decision is explained.** Each choice appends a readable string to `plan.decisions`.
10. **No hardcoded thresholds.** All numbers in §4 live in `server/src/config.ts` or the optimizer's settings and are changeable from the dashboard where stated.
11. **Business logic never imports a cloud SDK.** Cloud access goes only through the adapters in §6.

---

## 4. Business rules

All scores are scaled **0–100**.

### Bin classification

| Class | Rule | Route treatment |
|---|---|---|
| **Must visit** | fill > 85%, OR predicted to overflow before the zone's next collection, OR hazard flag | mandatory stop |
| **Visit if nearby** | 40% ≤ fill ≤ 85% (and not must-visit) | optional stop, dropped if the detour is not worth its priority |
| **Skip** | fill < 40% | not visited; on the skip list |

**Hazard flag:** gas > 400 ppm or temperature > 55 °C (configurable), or a citizen complaint.

**Urgent** (for the lone-bin rule): fill ≥ 95%, or predicted overflow before the next collection, or hazard.

### Priority score (optional stops)

```
Priority = 0.5 × Fill% + 0.3 × OverflowRisk + 0.2 × LocationWeight
```

- Weights are configurable from the dashboard and normalised to sum to 1.
- `hours_to_full = (100 − fill) / max(fill_rate_pct_per_hour, 0.01)`
- `hours_left` = hours until the zone's next collection.
- `OverflowRisk = clamp(100 × (1 − hours_to_full / hours_left), 0, 100)`. If `hours_to_full < hours_left`, the bin is predicted to overflow and becomes must-visit.
- **LocationWeight:** market 100, hospital 90, bus_stand 85, school 80, commercial 60, residential 40, park 30.

### Optimizer objective

Minimise **total road distance + skipped penalties**. Each optional bin gets `AddDisjunction([index], round(priority × penalty_scale))`. Default `penalty_scale` is 60 (a priority-70 bin is worth about 4.2 km of detour). It is exposed in the UI. The model is a **prize-collecting capacitated VRP** with dump-yard reload nodes (OR-Tools `cvrp_reload` pattern).

### Frequency Planner

Zone fill rate comes from history (slope of fill since last emptying; seed values on first start). `days_to_85 = (85 − 10) / rate_pct_per_day`. Intervals: under 1.5 days → daily; under 2.5 → every 2 days; under 3.5 → every 3 days; otherwise twice a week.

### Bin colours (map and legend)

Green below 40%, amber 40–85%, red above 85%, purple hazard, grey offline.

### Savings panel

Stops, kilometres, estimated fuel, **overflows missed** (bins that reached 100% before collection), each against the fixed-route baseline. The fixed baseline visits every bin of the due zones, with no skipping. Fuel factors are estimates and labelled so in the UI.

---

## 5. Scope

**Core (must work in the demo):** live colour-coded 3D bin map; Frequency Planner and collection calendar; daily plan with dispatch checks; OR-Tools routing with optional stops; trucks driving their routes live; manual sensor simulator; skip list; savings panel; overflow, hazard, low-battery and offline alerts in the UI.

**Stretch (only after core passes, and only if asked):** time windows, live traffic (Google Routes API), ML fill forecasting, Telegram/email alerts, driver PWA, citizen photo reports.

**Out of scope:** payments, billing, real municipal data integration, wet/dry waste separation, multi-city support, user management beyond a simple admin/driver split.

If a request is not in Core or Stretch, say so before building it.

---

## 6. Architecture and the cloud seam

The system runs **locally first** and targets **AWS** later. The original PDF used Google Cloud; the team switched to AWS on 2026-10-26 (see §9). Do not switch back unless this file changes.

| Concern | Local implementation | AWS target |
|---|---|---|
| Message bus | `LocalBus` (EventEmitter) | SNS topic `bin-readings` (HTTPS subscription to `/ingest/readings`) |
| Live state | `MemoryStore` + JSON snapshot | DynamoDB table `smartbin_state` |
| History | JSONL | DynamoDB table `bin_readings` (PK `bin_id`, SK `timestamp`) |
| Scheduled jobs | `node-cron` calling `/jobs/*` | EventBridge Scheduler calling the same HTTP endpoints |
| Services | Docker Compose | Same Compose file on one EC2 instance |
| Secrets | `.env` | SSM Parameter Store (SecureString) |

- Adapters live in `server/src/adapters/` as interfaces (`MessageBus`, `StateStore`, `HistoryStore`). Business logic depends only on the interfaces.
- `/ingest/readings` accepts a raw reading and an SNS HTTP notification envelope (`Type: "Notification"`, reading JSON in `Message`; `SubscriptionConfirmation` is answered by fetching `SubscribeURL`).
- Job endpoints: `POST /jobs/frequency`, `POST /jobs/daily`.
- AWS classes are documented and not wired by default; select with env vars (`BUS=sns`, `STORE=dynamodb`, `HISTORY=dynamodb`).

---

## 7. Locked tech stack

Do not add, swap or "modernise" these without asking.

- **Web:** Vite, React 18, TypeScript, Tailwind CSS, `maplibre-gl` v4, Zustand, `lucide-react`, `recharts`, `socket.io-client`.
- **Map:** plain MapLibre GL JS with MapTiler vector tiles and terrain-RGB (key in `VITE_MAPTILER_KEY`). Pitch **60**. Fallback to OpenFreeMap if no key. Do not add `@maptiler/sdk` alongside it.
- **Server:** Node 20, TypeScript, Express, Socket.io, `zod`, `node-cron`, `vitest`.
- **Optimizer:** Python 3.11, FastAPI, Uvicorn, Pydantic v2, `ortools`, `httpx`, `numpy`, `pytest`.
- **Road network:** OSRM (MLD, car profile) in Docker on a Gwalior OSM extract (bbox `78.05,26.12,78.32,26.32`).

Note: the original PDF named Next.js and Leaflet for the frontend. That was replaced on purpose (see §9).

---

## 8. Data contracts

The single reference is `shared/schemas.md`. Field names are `snake_case` on the wire. Change a contract in that file first, then in code.

**Sensor reading** (also what a future ESP32 sends):
`bin_id, fill_pct, lat, lng, battery, temp_c, gas_ppm, timestamp`

**Socket.io events (server → web):** `state:init`, `bins:update`, `trucks:update` (1 s), `routes:update`, `plan:update`, `alerts:new`, `savings:update`.

Truck `kind` is `primary_compactor` or `secondary_autotipper`. Bin `location_type` is one of market, hospital, bus_stand, school, commercial, residential, park.

---

## 9. Deliberate deviations from the original PDF

These are decided. Do not "correct" them back.

| PDF says | We do | Reason |
|---|---|---|
| Next.js + Leaflet 2D map | Vite + React + MapLibre **3D** map | Requirement for a professional 3D tracking interface |
| About 50 bins | About **45 bins per zone, 270 in total** in the local demo (`SEED_BIN_COUNT`, configurable). The design must scale to 150+ | A zone of ~45 bins at 120 kg each can clear the 2400 kg minimum load |
| Cloud Functions, Pub/Sub, Firestore at the center | Local adapters first; same interfaces map to AWS SNS, DynamoDB and EventBridge | Must run on one laptop for the demo |
| Multiple trucks and live GPS tracking were stretch / future | Multiple trucks and live truck movement are **core** | Needed for the 3D tracking demo |
| Dashboard on Cloud Run | Local first; one EC2 instance running Docker Compose later | As above |
| Everything on Google Cloud | Everything on **AWS** (decided 2026-10-26) | Team decision |

---

## 10. Facts that are assumptions, not data

Never present these as real. Mark them in code comments and in the UI where users see them.

- All bin coordinates, zone boundaries, depot and dump-yard locations. They are **approximate**; verify on the map.
- Truck capacities (compactor 6000 kg, auto-tipper 800 kg), speeds (22 km/h), service time (60 s per bin).
- Fuel factors (0.35 L/km compactor, 0.12 L/km auto-tipper).
- Fill rates per location type.
- Every savings and distance figure shown in the demo is **computed from simulated data**, not measured. The PDF's "40 → 18 stops, 32 → 13 km" are indicative targets, never hardcoded output.

---

## 11. Working rules (anti-hallucination)

1. **Read before you write.** Open the relevant spec section and the existing files you will touch. Do not rely on memory of earlier sessions.
2. **Do not invent** data, library APIs, endpoint names, config keys or file paths. If you are unsure of an API (OR-Tools, MapLibre, OSRM), check the installed package's docs or source, or write a small test.
3. **Real code only.** No placeholders, `TODO`, `pass`, or "implement later" in core logic: optimizer, dispatch, classification, priority, simulators.
4. **Fixed numbers come from config**, never typed inline.
5. **Stay in scope.** No new features, libraries, services or refactors that were not asked for. Mention an idea in your reply instead of building it.
6. **When blocked or ambiguous:** ask one specific question, or choose the safest reading, state it in your reply, and log it in `docs/ASSUMPTIONS.md` with the date.
7. **Do not claim it works unless you ran it.** Report what you ran and the result. If you could not run something (for example OSRM is not reachable), say so.
8. **Keep contracts in sync.** If you change a field, update `shared/schemas.md`, both ends, and the tests in the same change.
9. **Match names.** Use the terms in §12 exactly (must-visit, visit-if-nearby, skip, primary, secondary, dump yard, depot).
10. **Small, verifiable steps.** Finish and test one module before starting the next.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| Zone | A named area of Gwalior with its own fill rate and collection calendar (Maharaj Bada, Lashkar, City Centre, Thatipur, Morar, Hazira) |
| Due zone | A zone whose collection day is today |
| Primary truck | Large compactor (6000 kg) used for planned runs |
| Secondary truck | Small auto-tipper or e-rickshaw (800 kg) used for lone urgent bins |
| Depot | Where trucks start and end the day |
| Dump yard | Where trucks unload when full; modelled as reload nodes in the VRP |
| Optional stop | A visit-if-nearby bin with a drop penalty |
| Fixed baseline | What the route would be with every bin of the due zones mandatory, in street order; used only for comparison |
| Overflow missed | A bin that reached 100% before it was collected |

---

## 13. Definition of done (per feature)

- [ ] It follows §3 invariants and §4 rules, with the thresholds read from config.
- [ ] A test covers it. Required tests: far 50% bin dropped while a near one is kept; must-visit always kept; capacity never exceeded with a dump visit when needed; lone urgent bin → secondary truck; single 88% bin in a non-due zone → no dispatch; changing weights changes the dropped bins.
- [ ] Contracts and `shared/schemas.md` match.
- [ ] The UI shows decisions and assumptions honestly (fallback label, "estimate" on fuel).
- [ ] Your reply lists what you changed, what you ran, and anything you assumed.