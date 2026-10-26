# ASSUMPTIONS

Dated log of every assumption (CLAUDE.md §11.6). Never present these as real data.

## 2026-10-26

| ID | Assumption | Where |
|---|---|---|
| A | Bin capacity is 120 kg, used for expected load and VRP demand. Not in CLAUDE.md. (Briefly 500 kg on 2026-10-26; reverted the same day together with a denser seed so a zone can reach the 2400 kg minimum load.) | `server/src/config.ts` `binCapacityKg` |
| B | Fixed-route baseline "street order" = nearest-neighbour order from the depot over OSRM distances. | Phase 4 `baseline.py` |
| C | Baseline overflows missed = replay the baseline schedule (due zones, due days only) against the same simulated fill curves. | Phase 6/7 |
| D | Fleet: 3 primary compactors, 2 secondary auto-tippers. | `config.fleet` |
| E | Low battery below 20%; offline after 3 missed 60 s reporting intervals. | `config.alerts` |
| F | Zone calendars start on staggered dates so not every zone is due on day 1. | Phase 3 |
| G | `docs/Smart_Waste_Route_Optimizer_Idea.pdf` and `docs/proposal.md` are missing from the repo; `docs/SMARTBIN_prompt.md` is empty. CLAUDE.md is the only spec used. | — |
| H | Cloud target switched from Google Cloud to AWS by team decision; CLAUDE.md §6 and §9 updated to match. | `CLAUDE.md` |
| I | Dev machine runs Node 22 and Python 3.13; CLAUDE.md pins Node 20 and Python 3.11. Docker images (Phase 9) use Node 20 and Python 3.11. Local dev on newer versions is accepted unless a package breaks. | — |
| J | Unload time at the dump yard is 300 s. | `config.unloadSeconds` |
| K | Dashboard-editable settings: priority weights, `penalty_scale`, fill/hazard thresholds. Everything else is read-only. | `shared/schemas.md` Settings |
| L | AWS region default `ap-south-1` (Mumbai). | `.env.example` |
| M | Fill rates per hour by location type (market 3.0 … park 0.8) are invented seed values. | `config.fillRatePctPerHour` |
| N | Gwalior zone polygons, depot, dump yard and bin coordinates are approximate and must be verified on the map. | Phase 1 `seed.ts` |

## 2026-10-26 (Phase 2)

| ID | Assumption | Where |
|---|---|---|
| O | SNS message signatures are not verified. Subscription confirmation only fetches `https://sns.<region>.amazonaws.com` URLs. Add signature checks before exposing `/ingest/readings` on the internet. | `server/src/http/ingest.ts` |
| P | A reading for an unknown `bin_id` is rejected with 422, not auto-created. | `server/src/routes.ts` |
| Q | A reading updates position (`lat`, `lng`) as well as fill, battery, temperature and gas. | `server/src/pipeline.ts` |
| R | Until Phase 3, `bins:update` and `state:init` carry stored bin fields only; derived fields (`bin_class`, `color`, `priority`, ...) arrive with the classifier. | `server/src/pipeline.ts` |
| S | State snapshots are written every 30 s and on graceful shutdown (SIGINT/SIGTERM). A hard kill can lose up to 30 s of state. | `server/src/index.ts` |

## 2026-10-26 (Phase 3)

| ID | Assumption | Where |
|---|---|---|
| T | Collection runs start at 06:00 local time (UTC+05:30, no DST). | `config.collectionStartHour` |
| U | "Twice a week" = Monday and Thursday. | `config.frequency.twiceAWeekDays` |
| V | A bin's own `fill_rate_pct_per_hour` stays at its seed value; only the zone rate is learned from history (mean bin slope since last emptying, at least 3 bins with 12 h of rising readings). | `server/src/domain/frequency.ts` |
| W | `hours_left` uses the first calendar date after today, so on a due day it is the collection after today's. | `server/src/domain/classify.ts` |
| X | Derived bin fields are recomputed when a bin changes or state is requested, not on a timer; they can lag until the next reading. | `server/src/pipeline.ts` |

## 2026-10-26 (Phase 4)

| ID | Assumption | Where |
|---|---|---|
| Y | Shift limit: one vehicle's route (driving + 60 s per bin + 300 s per dump visit, depot to depot) may last at most 8 h (`SHIFT_SECONDS`, request field `shift_limit_s`). Not in CLAUDE.md. A must-visit bin that cannot fit returns 422 `infeasible`. The baseline ignores it. | `optimizer/app/solver.py` |
| Z | Baseline = nearest-neighbour order from the depot, split into contiguous chunks per vehicle in proportion to capacity, with dump trips when full (open items B, C: the missed-overflow replay is Phase 6/7). | `optimizer/app/baseline.py` |
| AA | The model gets at most `min(n_bins, ceil(2 * total_demand / smallest_capacity)) + n_vehicles` dump-yard copies (a proven upper bound on useful dump visits); repeated or leading dump stops are removed from the output. | `optimizer/app/solver.py` |
| AB | A must-visit bin heavier than the largest vehicle returns HTTP 422 `infeasible`; it is never dropped. | `optimizer/app/main.py` |

## 2026-10-26 (Phase 5)

| ID | Assumption | Where |
|---|---|---|
| AC | `last_collection_date` is not changed when a plan is built, so `/jobs/daily` can be re-run on the same day. The truck simulator (Phase 6) updates it when a zone's run finishes. | `server/src/jobs.ts` |
| AD | The fixed baseline covers every bin of every due zone, deferred zones included, because a fixed schedule has no minimum-load check. It also counts toward `plan.distance_source`. | `server/src/domain/dispatch.ts` |
| AE | `plan.due_zones` lists every zone due today (CLAUDE.md glossary), deferred ones included; `deferred_zones` is the subset skipped for low load. | `server/src/domain/dispatch.ts` |
| AF | Offline bins are planned from their last known values. | `server/src/domain/dispatch.ts` |
| AG | Cron: `/jobs/frequency` at 00:00 and `/jobs/daily` at 00:30 Asia/Kolkata. | `config.cron` |
| AH | An urgent bin in a deferred due zone goes to a secondary truck (the zone has no run today). With the seed data this sends many bins to secondary trucks when a zone with many predicted-overflow bins is deferred (see the Phase 5 report). | `server/src/domain/dispatch.ts` |

## 2026-10-26 (edge-case fixes)

| ID | Assumption | Where |
|---|---|---|
| AI | "Urgent" for the override means `bin.urgent` (fill >= 95%, predicted overflow, or hazard), counted per zone. Standard 85-95% must-visit bins do not count. | `server/src/domain/dispatch.ts` |
| AJ | Urgent override applies only to zones due today. A zone that is not due keeps invariant 2 (planned days only): secondary trucks take its 2 highest-priority urgent bins and the rest wait, logged in `plan.decisions`, even though they may overflow before the next collection. | `server/src/domain/dispatch.ts` |
| AK | Seed: 270 bins, 45 per zone (`SEED_BIN_COUNT`), matching the "about 50 bins per area" request. CLAUDE.md section 9 updated. | `server/src/config.ts` |

## 2026-10-27 (Phase 6)

| ID | Assumption | Where |
|---|---|---|
| AL | All simulator numbers are invented, not data: fill noise +/-20%, battery drain 0.5-3 %/day per bin, gas spikes (+350-600 ppm, 0.002 per bin-hour), temperature spikes (+28-40 C, 0.0005), outages (0.001 per bin-hour, 1-3 h), spike length 2-4 h. | `config.sim` |
| AM | With the simulator on (default, `SIM=off` disables it) scheduled jobs fire on simulated time (00:00 frequency, 00:30 daily local) by calling the same `/jobs/*` endpoints; node-cron is used only when the simulator is off. | `server/src/index.ts`, `sim/engine.ts` |
| AN | Trucks leave at the later of the plan time and 06:00 local on the plan date. A truck still driving finishes its route before the next plan's route starts. | `sim/trucks.ts` |
| AO | A truck's load follows the plan's `load_after_kg` (not the live fill of the bin). The bin is emptied completely. A truck unloads fully when it is back at the depot (no unload stop at the end of a shift). | `sim/trucks.ts` |
| AP | A zone counts as collected (its `last_collection_date` moves to the plan date) when every primary route of that plan has finished. | `sim/trucks.ts` |
| AQ | Missed-overflow baseline replay: on a zone's fixed collection day, at 06:00 local, every bin of the zone is emptied at once (no travel time, no deferral, no secondary trucks); overflow episodes are counted once per bin until it is emptied. | `sim/engine.ts` |
| AR | Truck runs are not saved in the snapshot; after a restart every truck starts idle at the depot. Overflow counters are in memory only. | `sim/engine.ts` |
| AS | Trucks move at a constant 22 km/h along the OSRM geometry, scaled so the route length equals the sum of the OSRM leg distances. | `sim/trucks.ts` |

## 2026-10-27 (Phase 7)

| ID | Assumption | Where |
|---|---|---|
| AT | Savings compare the plan (planned stops and road km), not what the trucks later drove. Dump-yard visits are not counted as stops. | `server/src/domain/savings.ts` |
| AU | The fixed baseline burns fuel as primary compactors only (0.35 L/km), because a fixed schedule has no secondary trucks. | `server/src/domain/savings.ts` |
| AV | The cumulative stops, km and fuel cover plan dates recorded since the ledger started; the ledger is saved in the snapshot. Overflow counts are in memory only (AR), so after a restart the cumulative overflows restart at zero while the other totals continue. | `server/src/savings.ts` |
| AW | The baseline route length comes from the nearest-neighbour baseline (assumption Z), so the km figure is only as good as that heuristic. | `optimizer/app/baseline.py` |

## 2026-10-26 (Phase 8, web dashboard)

| ID | Assumption | Where |
|---|---|---|
| AX | The user approved React Bits and its dependencies on 2026-10-26, which goes past the locked web stack in CLAUDE.md section 7. One package was added: `motion` (needed by `CountUp`). CLAUDE.md section 7 is not edited; update it if the team keeps `motion`. | `web/package.json`, `web/src/components/reactbits/CountUp/` |
| AY | The base map is a dark style written in code over the OpenMapTiles schema, not a hosted MapTiler style. With `VITE_MAPTILER_KEY` it uses MapTiler vector tiles and terrain-RGB with hillshade. Without a key it uses OpenFreeMap tiles, no terrain, and the UI says so. The MapTiler path was not run (no key available). | `web/src/map/style.ts` |
| AZ | The browser calls the server through a proxy at `/api` (Vite dev and preview) because the server's HTTP routes send no CORS headers. Socket.io goes through the same proxy. A production deployment needs the same `/api` and `/socket.io` routes in its web server (Phase 9). | `web/vite.config.ts`, `web/src/api.ts` |
| BA | `?tab=<id>` in the URL opens a panel directly. In development `window.__map` exposes the map for browser tests. | `web/src/store.ts`, `web/src/MapView.tsx` |
| BB | Truck positions glide between the 1 s `trucks:update` events by linear interpolation in the browser. Heading is the server's `heading_deg`. | `web/src/MapView.tsx` |
| BC | Colour on the map: bin colours are the CLAUDE.md section 4 set. Primary routes use steps of one blue, secondary routes are dashed white, so truck routes are never confused with bin states. | `web/src/truckColors.ts`, `web/src/index.css` |
