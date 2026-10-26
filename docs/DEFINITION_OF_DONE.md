# Definition of done: walk of CLAUDE.md section 13

Checked on 2026-10-26 against the Compose stack, `vitest` (server), `pytest` (optimizer) and a browser run of the dashboard. "Manual" means checked by running the dashboard, with no automated test. The web package has no test runner (CLAUDE.md section 7 does not list one).

## Invariants (section 3)

| # | Invariant | Where it is enforced | Test |
|---|---|---|---|
| 1 | No trip for a single standard bin | `server/src/domain/dispatch.ts` | `dispatch.test.ts`: "88% bin, no overflow, no hazard -> no dispatch, decision logged" |
| 2 | Planned days only | `dispatch.ts` (primaries only for due zones) | `dispatch.test.ts` (non-due zone cases), `dispatch.integration.test.ts` |
| 3 | Minimum load check and urgent override | `dispatch.ts` | `dispatch.test.ts`: under-load deferral, exactly at the minimum, 3 urgent bins override, 2 do not |
| 4 | Lone urgent bin goes to a secondary truck, at most 2 per zone | `dispatch.ts` | `dispatch.test.ts`: secondary cases, "at most 2 urgent bins per zone"; `dispatch.integration.test.ts`: full plan |
| 5 | Must-visit is never dropped | `optimizer/app/solver.py` | `test_solver.py`: must-visit kept when far with zero priority; infeasible is an error, not a silent drop |
| 6 | Skip means skip | `dispatch.ts` | `dispatch.test.ts`: skip bins never sent to the optimizer or routed |
| 7 | Capacity never exceeded | `solver.py`, `sim/trucks.ts` | `test_solver.py`: capacity and dump visit; `trucks.test.ts`, `engine.test.ts`: load never exceeds capacity |
| 8 | Real road distances, labelled fallback | `optimizer/app/matrix.py`, `server/src/clients/osrm.ts` | `test_baseline_api.py`: fallback label; `osrm.test.ts`; manual: Plan tab badge; failure check with OSRM stopped |
| 9 | Every decision explained | `dispatch.ts` | `dispatch.test.ts`: every deferred zone, waiting bin and secondary dispatch has a decision line; manual: Plan tab lists `decisions` verbatim |
| 10 | No hardcoded thresholds | `server/src/config.ts`, `optimizer/app/settings.py` | `boundaries.test.ts`: no section 4 or 10 number as a literal in `domain/` or `sim/`; `config.test.ts` |
| 11 | Business logic imports no cloud SDK | `domain/` | `boundaries.test.ts` |

## Required tests (section 13)

| Required test | Test |
|---|---|
| Far 50% bin dropped while a near one is kept | `test_solver.py::test_far_optional_bin_dropped_while_near_one_kept` |
| Must-visit always kept | `test_solver.py::test_must_visit_is_kept_even_when_far_and_zero_priority` |
| Capacity never exceeded, dump visit when needed | `test_solver.py::test_capacity_never_exceeded_and_dump_visit_when_needed` |
| Lone urgent bin to the secondary truck | `dispatch.integration.test.ts`: "builds a full plan ... secondary truck for a lone urgent bin" |
| Single 88% bin in a non-due zone, no dispatch | `dispatch.test.ts` |
| Changing weights changes the dropped bins | `dispatch.integration.test.ts`: "changing the priority weights changes which optional bins are dropped" |

## Core features (section 5)

| Feature | Status |
|---|---|
| Live colour-coded 3D bin map | Manual: bins by colour, extruded buildings, pitch 60. Terrain only with a MapTiler key, which was not available to test. |
| Frequency Planner and collection calendar | `frequency.test.ts`; manual: Calendar tab |
| Daily plan with dispatch checks | `dispatch*.test.ts`; manual: Plan tab |
| OR-Tools routing with optional stops | `test_solver.py` |
| Trucks driving routes live | `trucks.test.ts`, `engine.test.ts`; manual: markers move along routes at 60x |
| Manual sensor simulator | `engine.test.ts`; manual: Simulator tab and bin popup |
| Skip list | `dispatch.test.ts`; manual: Plan tab, "Driver skip list" |
| Savings panel | `savings.test.ts`; manual: Savings tab, fuel marked "estimate", footer says simulated |
| Overflow, hazard, low-battery, offline alerts | `alerts.test.ts`; manual: Alerts tab |

## Contracts and honesty in the UI

- `shared/schemas.md` matches the code. `web/src/types.ts` mirrors `server/src/types.ts`. No contract changed in Phase 9.
- The UI says: positions are approximate (legend, Overview footer), fuel is an estimate, figures are from simulated data, and a visible badge shows when `haversine_fallback` is in use.

## Phase 9 changes

- Dockerfiles for `optimizer`, `server` and `web`; nginx in the web image proxies `/api` and `/socket.io` to the server.
- `docker-compose.yml`: health checks, `depends_on` conditions, optional `.env`, `VITE_MAPTILER_KEY` build argument.
- `scripts/demo.sh` and `README.md`.
- Fix: the history file could end up with torn lines under the 60x simulator on a bind-mounted volume, and the server then refused to start. Appends are now serialised, and unreadable lines are skipped and logged at start. Tests added in `persistence.test.ts`.
- Fix: `web/vite.config.ts` read `process` without Node types, which failed a clean `npm ci && npm run build`.
- New test: `boundaries.test.ts` checks that `domain/` and `sim/` hold no section 4 or 10 number as a literal.

## Not done or not verified

- The MapTiler path (key, terrain, hillshade).
- A fresh clone on another machine. The stack was rebuilt from scratch locally with an empty `server/data/`.
- `docker compose up` needs `osrm/data/` built first with `bash osrm/build.sh`; it is not part of the images.
