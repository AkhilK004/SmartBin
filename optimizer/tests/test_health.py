from fastapi.testclient import TestClient

from app.main import app
from app import settings


def test_health():
    r = TestClient(app).get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_settings_match_claude_md():
    assert settings.PENALTY_SCALE == 60
    assert settings.TRUCK_SPEED_KMH == 22
    assert settings.SERVICE_SECONDS_PER_BIN == 60
