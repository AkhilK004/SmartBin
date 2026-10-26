"""Fixed-route baseline (CLAUDE.md §4): every stop mandatory, no skipping, street order.

Assumption B: "street order" = nearest-neighbour order from the depot over road distances.
The sequence is split into contiguous chunks, one per vehicle, in proportion to capacity.
Dump-yard trips are added whenever the next bin would exceed capacity.
"""
from .common import DEPOT, demands_kg, make_route, stop_base
from .matrix import Matrix
from .models import InfeasibleError, OptimizeRequest, OptimizeResponse


def _nearest_neighbour_order(req: OptimizeRequest, matrix: Matrix) -> list[int]:
    remaining = set(range(len(req.stops)))
    order: list[int] = []
    current = DEPOT
    while remaining:
        nxt = min(remaining, key=lambda i: (matrix.distances_m[current][stop_base(i)], i))
        order.append(nxt)
        remaining.remove(nxt)
        current = stop_base(nxt)
    return order


def baseline(req: OptimizeRequest, matrix: Matrix) -> OptimizeResponse:
    demands = demands_kg(req)
    biggest = max(v.capacity_kg for v in req.vehicles)
    for s, d in zip(req.stops, demands):
        if d > biggest:
            raise InfeasibleError(f"bin {s.bin_id} holds {d} kg, above the largest vehicle capacity {int(biggest)} kg")
    if not req.stops:
        return OptimizeResponse(routes=[], dropped=[], distance_source=matrix.distance_source, decisions=[])

    order = _nearest_neighbour_order(req, matrix)
    total = sum(demands)
    cap_sum = sum(v.capacity_kg for v in req.vehicles)

    routes = []
    pos = 0
    for k, vehicle in enumerate(req.vehicles):
        last = k == len(req.vehicles) - 1
        target = total * vehicle.capacity_kg / cap_sum
        chunk: list[int] = []
        taken = 0
        while pos < len(order) and (last or taken < target or not chunk):
            chunk.append(order[pos])
            taken += demands[order[pos]]
            pos += 1
        if not chunk:
            continue
        seq: list[tuple[str, int | None]] = []
        load = 0
        cap = int(vehicle.capacity_kg)
        for i in chunk:
            if load + demands[i] > cap:
                seq.append(("dump", None))
                load = 0
            seq.append(("bin", i))
            load += demands[i]
        routes.append(make_route(req, matrix, vehicle, seq))

    decisions = [
        f"Baseline {r.vehicle_id}: {sum(1 for s in r.stops if s.type == 'bin')} stops, {r.distance_m / 1000:.1f} km"
        for r in routes
    ]
    return OptimizeResponse(routes=routes, dropped=[], distance_source=matrix.distance_source, decisions=decisions)
