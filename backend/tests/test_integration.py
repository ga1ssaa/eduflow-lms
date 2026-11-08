import os
import sys
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import get_engine, get_session_factory
from app.main import create_app
from testutils.database import guard_test_database_url


@pytest.mark.integration
def test_database_health_against_postgres(monkeypatch):
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Set TEST_DATABASE_URL to run the PostgreSQL integration test")
    try:
        guard_test_database_url(database_url)
    except ValueError as error:
        pytest.fail(str(error), pytrace=False)
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


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+psycopg://test@localhost/eduflow",
        "postgresql+psycopg://test@localhost/production",
        "postgresql+psycopg://test@localhost/eduflow_test_guard?dbname=production",
        "postgresql+psycopg://test@localhost/eduflow_test_guard?host=unexpected.example",
        "postgresql+psycopg://test@localhost/eduflow_test_guard?service=opaque-profile",
    ],
)
def test_database_health_refuses_non_test_targets(monkeypatch, database_url):
    monkeypatch.setenv("TEST_DATABASE_URL", database_url)
    client_factory = Mock(side_effect=AssertionError("Unsafe target reached the HTTP client"))
    monkeypatch.setattr(sys.modules[__name__], "TestClient", client_factory)
    with pytest.raises(pytest.fail.Exception, match="eduflow_test_"):
        test_database_health_against_postgres(monkeypatch)
    client_factory.assert_not_called()
