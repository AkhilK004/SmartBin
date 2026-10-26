# SmartBin Gwalior

IoT smart-waste system for Gwalior, Madhya Pradesh (BCS VII Cloud Computing, Topic 2). Smart bins report fill level, GPS and battery. The system sets collection frequency per zone, decides each day which bins to collect, skip or rush, routes trucks with OR-Tools over real road distances, and shows it all on a live 3D map.

The idea in one line: fewer stops and kilometres on trips that already happen, never an extra trip. `CLAUDE.md` is the source of truth for rules and scope.

**Everything on screen is computed from simulated data.** Bin, zone, depot and dump-yard positions are approximate. Fuel figures are estimates.

## Run it

Needs Docker with Compose v2.24 or newer.

```bash
bash osrm/build.sh          # once: downloads and builds the Gwalior road network (slow)
cp .env.example .env        # optional: set VITE_MAPTILER_KEY for terrain
docker compose up --build   # osrm, optimizer, server, web
```

Open http://localhost:5173. Ports: web 5173, server 4000, optimizer 8001, OSRM 5000.

Without `VITE_MAPTILER_KEY` the map uses OpenFreeMap and shows a "no terrain" note. With a key, set it in `.env` before `docker compose up --build`: it is baked into the web bundle at build time.

State is kept in `server/data/` (snapshot and history). Delete that folder for a fresh seed.

### Without Docker

```bash
# optimizer (Python 3.11)
cd optimizer && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8001
# server (Node 20)
cd server && npm ci && npm run dev
# web: Vite proxies /api and /socket.io to localhost:4000
cd web && npm ci && npm run dev
```

OSRM still runs from Compose: `docker compose up osrm`.

## Demo script

Run `bash scripts/demo.sh` (set `BASE=http://localhost:4000` to skip the web proxy). It does the steps below and prints each result. Do them by hand on the dashboard while it runs on a second screen.

1. **Seed.** The server seeds 270 bins in 6 zones on first start.
2. **Frequency.** `POST /jobs/frequency` sets each zone's interval. See the Calendar tab.
3. **Daily plan.** `POST /jobs/daily`, or "Run daily plan" on the map. See routes on the map and every decision in the Plan tab.
4. **Trucks run.** Set time to 60× (top bar). Trucks follow their routes, empty bins, and visit the dump yard when full.
5. **Savings.** The Savings tab compares the optimized plan with the fixed route.

Worth showing live (Simulator tab, or click a bin on the map):

- Set a bin in a zone that is not due to 88%: no truck is sent.
- Set it to 96%: a secondary auto-tipper takes it.
- Spike gas on a bin: it turns purple and an alert fires.
- Change the priority weights or penalty scale in Settings, then "Save and re-plan": the dropped bins change.

## Failure checks

Each was run against the Compose stack on 2026-10-26.

| Failure | What happens |
|---|---|
| Optimizer down (`docker compose stop optimizer`) | `POST /jobs/daily` returns 502. The plan has `error` set and no routes. The Plan tab shows the error. |
| OSRM down (`docker compose stop osrm`) | The plan still builds with `distance_source: "haversine_fallback"`. The Plan tab shows "Straight-line fallback distances". |
| Browser reload | Socket.io sends `state:init` on connect, so the dashboard comes back with the plan, alerts and savings. |
| Server restart | The snapshot restores bins, zones, plan and alerts. Truck runs and overflow counters restart (assumptions AR, AV). |
| History file with a torn line | Unreadable lines are skipped and logged at start. |

## Tests

```bash
cd server && npx vitest run         # 156 tests
cd optimizer && .venv/Scripts/python -m pytest   # 28 tests
cd web && npm run build             # type-check and bundle
```

## Layout

```
optimizer/  Python 3.11, FastAPI, OR-Tools (prize-collecting CVRP with dump-yard reloads)
server/     Node 20, Express, Socket.io; domain rules, simulators, adapters
web/        Vite, React 18, MapLibre GL, Zustand, Tailwind
osrm/       road-network build script
shared/     data contracts (schemas.md)
docs/       plan, assumptions, definition-of-done walk
```

AWS adapters (SNS, DynamoDB, EventBridge) are Phase 10 and not wired by default.
