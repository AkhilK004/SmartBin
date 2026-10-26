"""Prize-collecting capacitated VRP with dump-yard reload nodes (OR-Tools cvrp_reload pattern).

Objective (CLAUDE.md §4): total road distance (m) + penalties for dropped optional stops,
penalty = round(priority * penalty_scale). Must-visit stops get no disjunction, so the
solver can never drop them.
"""
import math

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from . import settings
from .common import DEPOT, DUMP, check_demands_fit, demands_kg, make_route, stop_base
from .matrix import Matrix
from .models import Dropped, InfeasibleError, OptimizeRequest, OptimizeResponse


def _reload_node_count(total_demand: int, caps: list[int]) -> int:
    if total_demand <= min(caps):
        return 0  # every vehicle can carry everything: no dump trip needed
    needed = math.ceil(total_demand / min(caps)) + len(caps)
    return min(settings.MAX_DUMP_VISITS_PER_VEHICLE * len(caps), needed)


def solve(req: OptimizeRequest, matrix: Matrix) -> OptimizeResponse:
    check_demands_fit(req)
    stops = req.stops
    n = len(stops)
    if n == 0:
        return OptimizeResponse(routes=[], dropped=[], distance_source=matrix.distance_source, decisions=[])

    vehicles = req.vehicles
    caps = [int(v.capacity_kg) for v in vehicles]
    max_cap = max(caps)
    demands = demands_kg(req)
    reloads = _reload_node_count(sum(demands), caps)
    num_nodes = 1 + n + reloads  # node 0 depot, 1..n stops, then dump-yard copies

    def base(node: int) -> int:
        if node == 0:
            return DEPOT
        return stop_base(node - 1) if node <= n else DUMP

    dist = [[matrix.distances_m[base(a)][base(b)] for b in range(num_nodes)] for a in range(num_nodes)]
    node_demand = [0] + demands + [-max_cap] * reloads

    manager = pywrapcp.RoutingIndexManager(num_nodes, len(vehicles), 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_cb(i: int, j: int) -> int:
        return dist[manager.IndexToNode(i)][manager.IndexToNode(j)]

    transit = routing.RegisterTransitCallback(distance_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit)

    def demand_cb(i: int) -> int:
        return node_demand[manager.IndexToNode(i)]

    demand_idx = routing.RegisterUnaryTransitCallback(demand_cb)
    routing.AddDimensionWithVehicleCapacity(demand_idx, max_cap, caps, True, "Capacity")
    capacity = routing.GetDimensionOrDie("Capacity")

    # Slack is only allowed at dump-yard nodes: that is where the load resets.
    for node in range(1, 1 + n):
        capacity.SlackVar(manager.NodeToIndex(node)).SetValue(0)
    for v in range(len(vehicles)):
        capacity.SlackVar(routing.Start(v)).SetValue(0)

    for i, s in enumerate(stops):
        index = manager.NodeToIndex(1 + i)
        if not s.mandatory:
            routing.AddDisjunction([index], round(s.priority * req.penalty_scale))
    for node in range(1 + n, num_nodes):
        routing.AddDisjunction([manager.NodeToIndex(node)], 0)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromMilliseconds(int(req.time_limit_s * 1000))

    solution = routing.SolveWithParameters(params)
    if solution is None:
        raise InfeasibleError("no route serves every must-visit stop within vehicle capacity")

    routes = []
    visited: set[int] = set()
    for v, vehicle in enumerate(vehicles):
        seq: list[tuple[str, int | None]] = []
        index = routing.Start(v)
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node != 0:
                if node <= n:
                    seq.append(("bin", node - 1))
                    visited.add(node - 1)
                elif seq and seq[-1][0] == "bin":
                    # dump-yard copies are free to chain; one unload per stop at the yard is enough
                    seq.append(("dump", None))
            index = solution.Value(routing.NextVar(index))
        if any(kind == "bin" for kind, _ in seq):
            routes.append(make_route(req, matrix, vehicle, seq))

    unserved_mandatory = [s.bin_id for i, s in enumerate(stops) if s.mandatory and i not in visited]
    if unserved_mandatory:
        raise InfeasibleError(f"solver left must-visit stops unserved: {unserved_mandatory}")

    dropped, decisions = _explain(req, matrix, routes, visited)
    return OptimizeResponse(
        routes=routes, dropped=dropped, distance_source=matrix.distance_source, decisions=decisions
    )


def _insertion_detour_m(req: OptimizeRequest, matrix: Matrix, routes, stop_index: int) -> int:
    """Cheapest extra distance to add this stop between two neighbours of the final routes."""
    index_of = {s.bin_id: i for i, s in enumerate(req.stops)}
    x = stop_base(stop_index)
    d = matrix.distances_m
    best = d[DEPOT][x] + d[x][DEPOT]
    for r in routes:
        nodes = [DEPOT]
        for st in r.stops:
            nodes.append(stop_base(index_of[st.bin_id]) if st.type == "bin" else DUMP)
        nodes.append(DEPOT)
        for a, b in zip(nodes, nodes[1:]):
            best = min(best, d[a][x] + d[x][b] - d[a][b])
    return best


def _explain(req, matrix, routes, visited) -> tuple[list[Dropped], list[str]]:
    dropped = []
    decisions = []
    if matrix.distance_source == "haversine_fallback":
        decisions.append("Road distances unavailable: using straight-line distances x road factor (estimate).")
    for i, s in enumerate(req.stops):
        if s.mandatory or i in visited:
            continue
        value_m = round(s.priority * req.penalty_scale)
        detour_m = _insertion_detour_m(req, matrix, routes, i)
        reason = (
            f"detour {detour_m / 1000:.1f} km vs priority value {value_m / 1000:.1f} km "
            f"(priority {s.priority:g} x scale {req.penalty_scale:g}); capacity limits applied"
        )
        dropped.append(Dropped(bin_id=s.bin_id, reason=reason))
        decisions.append(f"{s.bin_id} dropped: {reason}")
    for r in routes:
        bins = sum(1 for st in r.stops if st.type == "bin")
        dumps = sum(1 for st in r.stops if st.type == "dump_yard")
        decisions.append(f"{r.vehicle_id}: {bins} stops, {r.distance_m / 1000:.1f} km, {dumps} dump-yard trip(s)")
    return dropped, decisions
