import httpx
import pytest
from fastapi.testclient import TestClient

from app import settings
from app.baseline import baseline
from app.main import app
from app.solver import solve

from .helpers import at, matrix_for, primary, request, stop, visited_ids

client = TestClient(app)


def test_baseline_visits_every_stop_and_never_drops():
    stops = [stop(f"B{i}", at(north_km=i % 5, east_km=i), priority=10) for i in range(1, 11)]
    req = request(stops, vehicles=[primary("A"), primary("B")])
    res = baseline(req, matrix_for(req))
    assert visited_ids(res) == {s.bin_id for s in stops}
    assert res.dropped == []


def test_baseline_respects_capacity_with_dump_trips():
    stops = [stop(f"B{i}", at(north_km=i), demand=400) for i in range(1, 6)]
    req = request(stops, vehicles=[primary(capacity=1000)])
    res = baseline(req, matrix_for(req))
    route = res.routes[0]
    assert any(s.type == "dump_yard" for s in route.stops)
    assert all(s.load_after_kg <= 1000 for s in route.stops)


def test_optimized_route_is_not_longer_than_baseline_when_all_stops_kept():
    stops = [stop(f"B{i}", at(north_km=(i * 7) % 9 - 4, east_km=(i * 5) % 11 - 5), mandatory=True) for i in range(1, 21)]
    req = request(stops, time_limit_s=3)
    m = matrix_for(req)
    opt = sum(r.distance_m for r in solve(req, m).routes)
    base = sum(r.distance_m for r in baseline(req, m).routes)
    assert opt <= base


def payload(stops, **kw):
    return request(stops, **kw).model_dump()


@pytest.fixture
def osrm_down(monkeypatch):
    monkeypatch.setattr(settings, "OSRM_URL", "http://127.0.0.1:9")


def test_api_fallback_is_labelled_when_osrm_is_down(osrm_down):
    body = payload([stop("MUST", at(north_km=1), mandatory=True), stop("OPT", at(north_km=1.5))])
    r = client.post("/optimize", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["distance_source"] == "haversine_fallback"
    assert any("straight-line" in d for d in data["decisions"])
    assert {"routes", "dropped", "distance_source", "decisions"} <= data.keys()


def test_api_baseline_endpoint(osrm_down):
    r = client.post("/baseline", json=payload([stop("A", at(north_km=1)), stop("B", at(north_km=2))]))
    assert r.status_code == 200
    assert r.json()["dropped"] == []


def test_api_returns_422_for_infeasible_must_visit(osrm_down):
    body = payload([stop("HEAVY", at(north_km=1), mandatory=True, demand=2000)], vehicles=[primary(capacity=1000)])
    r = client.post("/optimize", json=body)
    assert r.status_code == 422
    assert r.json()["error"] == "infeasible"
    assert "HEAVY" in r.json()["detail"]


def test_api_rejects_invalid_payload():
    assert client.post("/optimize", json={"stops": []}).status_code == 422


def _osrm_up() -> bool:
    try:
        return httpx.get("http://localhost:5000/route/v1/driving/78.17,26.2;78.18,26.21?overview=false", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


@pytest.mark.skipif(not _osrm_up(), reason="OSRM not running on localhost:5000")
def test_live_osrm_road_distances_on_gwalior_bins(monkeypatch):
    monkeypatch.setattr(settings, "OSRM_URL", "http://localhost:5000")
    # approximate Gwalior depot and bin positions from server/src/seed.ts
    body = {
        "depot": {"lat": 26.199, "lng": 78.195},
        "dump_yard": {"lat": 26.175, "lng": 78.24},
        "vehicles": [{"vehicle_id": "T-P1", "kind": "primary_compactor", "capacity_kg": 6000}],
        "stops": [
            {"bin_id": "B-1", "lat": 26.21, "lng": 78.20, "demand_kg": 60, "mandatory": True, "priority": 90},
            {"bin_id": "B-2", "lat": 26.215, "lng": 78.19, "demand_kg": 60, "mandatory": False, "priority": 70},
            {"bin_id": "B-3", "lat": 26.19, "lng": 78.21, "demand_kg": 60, "mandatory": False, "priority": 60},
        ],
        "time_limit_s": 2,
    }
    r = client.post("/optimize", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["distance_source"] == "osrm"
    assert data["routes"][0]["distance_m"] > 0
