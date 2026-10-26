"""Distance matrix from OSRM /table, with a labelled haversine fallback (CLAUDE.md §3.8)."""
import math
from dataclasses import dataclass

import httpx

from . import settings

EARTH_RADIUS_M = 6_371_000


@dataclass
class Matrix:
    distances_m: list[list[int]]
    durations_s: list[list[int]]
    distance_source: str  # "osrm" | "haversine_fallback"


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlng = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def fallback_matrix(points: list[tuple[float, float]]) -> Matrix:
    speed_ms = settings.TRUCK_SPEED_KMH * 1000 / 3600
    dist = [
        [round(haversine_m(a[0], a[1], b[0], b[1]) * settings.HAVERSINE_ROAD_FACTOR) for b in points]
        for a in points
    ]
    dur = [[round(d / speed_ms) for d in row] for row in dist]
    return Matrix(dist, dur, "haversine_fallback")


def build_matrix(
    points: list[tuple[float, float]],
    client: httpx.Client | None = None,
    base_url: str | None = None,
) -> Matrix:
    """points are (lat, lng). Returns integer metres and seconds."""
    base_url = base_url or settings.OSRM_URL
    own = client is None
    client = client or httpx.Client(timeout=settings.OSRM_TIMEOUT_S)
    try:
        coords = ";".join(f"{lng},{lat}" for lat, lng in points)
        r = client.get(f"{base_url}/table/v1/driving/{coords}", params={"annotations": "distance,duration"})
        r.raise_for_status()
        body = r.json()
        if body.get("code") != "Ok":
            raise ValueError(body.get("code"))
        dist = [[round(v) for v in row] for row in body["distances"]]
        dur = [[round(v) for v in row] for row in body["durations"]]
        return Matrix(dist, dur, "osrm")
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return fallback_matrix(points)
    finally:
        if own:
            client.close()
