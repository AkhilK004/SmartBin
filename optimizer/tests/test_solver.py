import random
import time

import pytest

from app.models import InfeasibleError
from app.solver import solve

from .helpers import at, matrix_for, primary, request, stop, visited_ids


def run(req):
    return solve(req, matrix_for(req))


def test_far_optional_bin_dropped_while_near_one_kept():
    req = request(
        [
            stop("MUST", at(north_km=1), mandatory=True, priority=90),
            stop("NEAR", at(north_km=1.2), priority=50),
            stop("FAR", at(east_km=20), priority=50),
        ]
    )
    res = run(req)
    assert "NEAR" in visited_ids(res)
    assert "FAR" not in visited_ids(res)
    assert [d.bin_id for d in res.dropped] == ["FAR"]
    assert any("FAR dropped" in d for d in res.decisions)


def test_must_visit_is_kept_even_when_far_and_zero_priority():
    req = request(
        [
            stop("FAR-MUST", at(east_km=25), mandatory=True, priority=0),
            stop("NEAR", at(north_km=1), priority=50),
        ]
    )
    res = run(req)
    assert "FAR-MUST" in visited_ids(res)


def test_capacity_never_exceeded_and_dump_visit_when_needed():
    stops = [stop(f"B{i}", at(north_km=1 + i, east_km=i % 2), mandatory=True, demand=400) for i in range(5)]
    req = request(stops, vehicles=[primary(capacity=1000)])
    res = run(req)

    assert visited_ids(res) == {f"B{i}" for i in range(5)}
    route = res.routes[0]
    dumps = [s for s in route.stops if s.type == "dump_yard"]
    assert len(dumps) >= 1
    assert all(s.load_after_kg <= 1000 for s in route.stops)
    assert all(s.load_after_kg == 0 for s in dumps)


def test_dump_visits_are_never_leading_or_repeated():
    stops = [stop(f"B{i}", at(north_km=1 + i, east_km=i % 2), mandatory=True, demand=400) for i in range(5)]
    res = run(request(stops, vehicles=[primary(capacity=1000)]))
    kinds = [s.type for s in res.routes[0].stops]
    assert kinds[0] == "bin"
    assert "dump_yard" in kinds
    assert not any(a == b == "dump_yard" for a, b in zip(kinds, kinds[1:]))


def test_no_dump_visit_when_everything_fits():
    stops = [stop(f"B{i}", at(north_km=1 + i), mandatory=True, demand=100) for i in range(4)]
    res = run(request(stops))
    assert all(s.type == "bin" for s in res.routes[0].stops)


def test_higher_priority_brings_a_dropped_bin_back():
    def with_priority(p):
        return run(
            request(
                [
                    stop("MUST", at(north_km=1), mandatory=True),
                    stop("EAST", at(east_km=2), priority=p),
                ],
                penalty_scale=100,
            )
        )

    assert "EAST" not in visited_ids(with_priority(30))  # value 3 km < detour
    assert "EAST" in visited_ids(with_priority(90))  # value 9 km > detour


def test_higher_penalty_scale_brings_a_dropped_bin_back():
    def with_scale(scale):
        return run(
            request(
                [
                    stop("MUST", at(north_km=1), mandatory=True),
                    stop("EAST", at(east_km=2), priority=50),
                ],
                penalty_scale=scale,
            )
        )

    assert "EAST" not in visited_ids(with_scale(60))  # 3 km
    assert "EAST" in visited_ids(with_scale(300))  # 15 km


def test_infeasible_must_visit_is_an_error_not_a_silent_drop():
    req = request([stop("HEAVY", at(north_km=1), mandatory=True, demand=2000)], vehicles=[primary(capacity=1000)])
    with pytest.raises(InfeasibleError, match="HEAVY"):
        run(req)


def test_no_stops_gives_empty_plan():
    res = run(request([]))
    assert res.routes == [] and res.dropped == []


def test_two_vehicles_each_respect_their_own_capacity():
    stops = [stop(f"B{i}", at(north_km=1 + i), mandatory=True, demand=300) for i in range(6)]
    req = request(stops, vehicles=[primary("A", 1000), primary("B", 400)])
    res = run(req)
    caps = {"A": 1000, "B": 400}
    assert visited_ids(res) == {f"B{i}" for i in range(6)}
    for r in res.routes:
        assert all(s.load_after_kg <= caps[r.vehicle_id] for s in r.stops)


def test_150_bins_solve_within_the_time_limit():
    rng = random.Random(7)
    stops = []
    for i in range(150):
        pos = at(north_km=rng.uniform(-8, 8), east_km=rng.uniform(-8, 8))
        stops.append(stop(f"B{i:03d}", pos, mandatory=i % 4 == 0, priority=rng.uniform(20, 95), demand=rng.randint(40, 120)))
    req = request(stops, vehicles=[primary(f"T-P{k}") for k in range(1, 4)], time_limit_s=5)

    started = time.perf_counter()
    res = run(req)
    elapsed = time.perf_counter() - started

    assert elapsed < 20
    mandatory = {s.bin_id for s in stops if s.mandatory}
    assert mandatory <= visited_ids(res)
    for r in res.routes:
        assert all(s.load_after_kg <= 6000 for s in r.stops)
    assert len(visited_ids(res)) + len(res.dropped) == 150
