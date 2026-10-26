from app.common import request_points
from app.matrix import fallback_matrix
from app.models import OptimizeRequest, Point, Stop, Vehicle

DEPOT = (26.20, 78.17)
DUMP = (26.201, 78.171)
KM_LAT = 1 / 111.0  # degrees of latitude per km
KM_LNG = 1 / (111.0 * 0.897)  # degrees of longitude per km at ~26.2 N


def at(north_km: float = 0.0, east_km: float = 0.0) -> tuple[float, float]:
    return (DEPOT[0] + north_km * KM_LAT, DEPOT[1] + east_km * KM_LNG)


def stop(bin_id: str, pos: tuple[float, float], *, mandatory=False, priority=50.0, demand=50.0) -> Stop:
    return Stop(bin_id=bin_id, lat=pos[0], lng=pos[1], demand_kg=demand, mandatory=mandatory, priority=priority)


def primary(vehicle_id="T-P1", capacity=6000.0) -> Vehicle:
    return Vehicle(vehicle_id=vehicle_id, kind="primary_compactor", capacity_kg=capacity)


def request(stops, vehicles=None, **kw) -> OptimizeRequest:
    kw.setdefault("time_limit_s", 1)
    return OptimizeRequest(
        depot=Point(lat=DEPOT[0], lng=DEPOT[1]),
        dump_yard=Point(lat=DUMP[0], lng=DUMP[1]),
        vehicles=vehicles or [primary()],
        stops=stops,
        **kw,
    )


def matrix_for(req: OptimizeRequest):
    return fallback_matrix(request_points(req))


def visited_ids(response) -> set[str]:
    return {s.bin_id for r in response.routes for s in r.stops if s.type == "bin"}
