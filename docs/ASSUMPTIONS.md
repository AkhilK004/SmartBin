# ASSUMPTIONS

Dated log of every assumption (CLAUDE.md §11.6). Never present these as real data.

## 2026-10-26

| ID | Assumption | Where |
|---|---|---|
| A | Bin capacity is 120 kg, used for expected load and VRP demand. Not in CLAUDE.md. | `server/src/config.ts` `binCapacityKg` |
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
