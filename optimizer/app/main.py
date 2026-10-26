from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .baseline import baseline
from .common import request_points
from .matrix import build_matrix
from .models import InfeasibleError, OptimizeRequest, OptimizeResponse
from .solver import solve

app = FastAPI(title="SmartBin optimizer")


@app.exception_handler(InfeasibleError)
def infeasible_handler(_request, exc: InfeasibleError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": "infeasible", "detail": str(exc)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest) -> OptimizeResponse:
    return solve(req, build_matrix(request_points(req)))


@app.post("/baseline", response_model=OptimizeResponse)
def baseline_route(req: OptimizeRequest) -> OptimizeResponse:
    return baseline(req, build_matrix(request_points(req)))
