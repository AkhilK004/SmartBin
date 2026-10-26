"""Shared helpers: point/matrix layout and turning a node sequence into a Route."""
from . import settings
from .matrix import Matrix
from .models import InfeasibleError, OptimizeRequest, Route, RouteStop, Vehicle

# Matrix layout: index 0 = depot, 1 = dump yard, 2 + i = stop i
DEPOT = 0
DUMP = 1


def stop_base(i: int) -> int:
    return 2 + i


def request_points(req: OptimizeRequest) -> list[tuple[float, float]]:
    return (
        [(req.depot.lat, req.depot.lng), (req.dump_yard.lat, req.dump_yard.lng)]
        + [(s.lat, s.lng) for s in req.stops]
    )


def demands_kg(req: OptimizeRequest) -> list[int]:
    return [max(0, round(s.demand_kg)) for s in req.stops]


def check_demands_fit(req: OptimizeRequest) -> None:
    """A bin heavier than the largest truck can never be served."""
    biggest = max(v.capacity_kg for v in req.vehicles)
    for s, d in zip(req.stops, demands_kg(req)):
        if s.mandatory and d > biggest:
            raise InfeasibleError(
                f"must-visit bin {s.bin_id} holds {d} kg, above the largest vehicle capacity {int(biggest)} kg"
            )


def make_route(
    req: OptimizeRequest,
    matrix: Matrix,
    vehicle: Vehicle,
    seq: list[tuple[str, int | None]],
) -> Route:
    """seq: ordered ('bin', stop_index) or ('dump', None); depot start and end are implicit.

    Loads are simulated here (a dump visit unloads fully), so the reported
    load_after_kg is exact and capacity is checked independently of the solver.
    """
    demands = demands_kg(req)
    cap = int(vehicle.capacity_kg)
    stops = []
    load = 0
    prev = DEPOT
    dist = 0
    dur = 0
    for kind, i in seq:
        if kind == "bin":
            assert i is not None
            node = stop_base(i)
            load += demands[i]
            if load > cap:
                raise InfeasibleError(f"internal: {vehicle.vehicle_id} would carry {load} kg above capacity {cap} kg")
            s = req.stops[i]
            stops.append(RouteStop(type="bin", bin_id=s.bin_id, lat=s.lat, lng=s.lng, load_after_kg=load))
            dur += settings.SERVICE_SECONDS_PER_BIN
        else:
            node = DUMP
            load = 0
            stops.append(RouteStop(type="dump_yard", lat=req.dump_yard.lat, lng=req.dump_yard.lng, load_after_kg=0))
            dur += settings.UNLOAD_SECONDS
        dist += matrix.distances_m[prev][node]
        dur += matrix.durations_s[prev][node]
        prev = node
    dist += matrix.distances_m[prev][DEPOT]
    dur += matrix.durations_s[prev][DEPOT]
    return Route(vehicle_id=vehicle.vehicle_id, stops=stops, distance_m=dist, duration_s=dur)
