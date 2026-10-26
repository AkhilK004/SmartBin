"""Request/response models. Mirror of shared/schemas.md (Optimizer API)."""
from typing import Literal

from pydantic import BaseModel, Field

from . import settings


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Vehicle(BaseModel):
    vehicle_id: str
    kind: Literal["primary_compactor", "secondary_autotipper"]
    capacity_kg: float = Field(gt=0)


class Stop(BaseModel):
    bin_id: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    demand_kg: float = Field(ge=0)
    # True = must-visit (no disjunction). False = optional stop with a drop penalty.
    mandatory: bool
    priority: float = Field(ge=0, le=100)


class OptimizeRequest(BaseModel):
    depot: Point
    dump_yard: Point
    vehicles: list[Vehicle] = Field(min_length=1)
    stops: list[Stop]
    penalty_scale: float = Field(default=settings.PENALTY_SCALE, ge=0)
    time_limit_s: float = Field(default=settings.TIME_LIMIT_S, gt=0, le=120)
    # Max duration of one vehicle's route, depot to depot (driving + service + unloading)
    shift_limit_s: float = Field(default=settings.SHIFT_SECONDS, gt=0)


class RouteStop(BaseModel):
    type: Literal["bin", "dump_yard"]
    bin_id: str | None = None
    lat: float
    lng: float
    load_after_kg: int


class Route(BaseModel):
    vehicle_id: str
    stops: list[RouteStop]
    distance_m: int
    duration_s: int


class Dropped(BaseModel):
    bin_id: str
    reason: str


class OptimizeResponse(BaseModel):
    routes: list[Route]
    dropped: list[Dropped]
    distance_source: Literal["osrm", "haversine_fallback"]
    decisions: list[str]


class InfeasibleError(Exception):
    """Raised when must-visit stops cannot be served; they are never dropped silently."""
