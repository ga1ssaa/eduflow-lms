import os

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import get_engine, get_session_factory
from app.main import create_app


@pytest.mark.integration
def test_database_health_against_postgres(monkeypatch):
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Set TEST_DATABASE_URL to run the PostgreSQL integration test")
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    try:
        with TestClient(create_app()) as client:
            response = client.get("/api/v1/health/db")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
    finally:
        if get_engine.cache_info().currsize:
            get_engine().dispose()
        get_session_factory.cache_clear()
        get_engine.cache_clear()
        get_settings.cache_clear()
