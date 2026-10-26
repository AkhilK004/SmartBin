#!/usr/bin/env bash
# Demo day: seed -> /jobs/frequency -> /jobs/daily -> trucks at 60x -> savings.
# Needs the stack up (docker compose up) and curl + node. BASE can point at the server directly.
set -euo pipefail

BASE="${BASE:-http://localhost:5173/api}"
SPEED="${SPEED:-60}"
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }

echo "1. State: $(curl -fsS "$BASE/state" | json "j.bins.length+' bins, '+j.zones.length+' zones, '+j.trucks.length+' trucks'")"

echo "2. Frequency planner"
curl -fsS -X POST "$BASE/jobs/frequency" | json "j.map(z=>'   '+z.name+': '+z.interval_label+', next '+z.next_collection_date).join('\n')"

echo "3. Daily plan"
curl -sS -X POST "$BASE/jobs/daily" | json "j.error ? '   PLAN ERROR: '+j.error : '   due '+j.due_zones.join(', ')+'; '+j.routes.length+' routes; '+j.routes.reduce((n,r)=>n+r.stops.filter(s=>s.type==='bin').length,0)+' stops; distance source '+j.distance_source+'; '+j.skip_list.length+' bins on the skip list'"

echo "4. Time speed ${SPEED}x"
curl -fsS -X POST "$BASE/sim/speed" -H 'content-type: application/json' -d "{\"speed\":${SPEED}}" | json "'   now '+j.now"

echo "5. Trucks (open the dashboard at ${BASE%/api} to watch them)"
sleep 5
curl -fsS "$BASE/state" | json "j.trucks.map(t=>'   '+t.truck_id+' '+t.status+' load '+Math.round(t.load_kg)+'/'+t.capacity_kg+' kg').join('\n')"

echo "6. Savings (simulated data, fuel is an estimate)"
curl -sS "$BASE/savings" | json "j.error ? '   '+j.error : ['stops','km','fuel_l','overflows_missed'].map(k=>'   '+k+': fixed '+j[k].baseline+' -> optimized '+j[k].optimized).join('\n')"
