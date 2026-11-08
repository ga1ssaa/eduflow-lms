import os
import secrets
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.core.config import get_settings
from app.db.session import get_engine, get_session_factory
from app.main import create_app
from testutils.database import guard_test_database_url

CSRF_HEADERS = {"Origin": "http://localhost:5173", "X-CSRF-Token": "1"}


def clear_caches():
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def migrated_auth_database():
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Set TEST_DATABASE_URL to a dedicated eduflow_test_ PostgreSQL database")
    try:
        guard_test_database_url(database_url)
    except ValueError as error:
        pytest.fail(str(error), pytrace=False)
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("DATABASE_URL", database_url)
        patch.setenv("JWT_SECRET", secrets.token_urlsafe(48))
        clear_caches()
        backend = Path(__file__).resolve().parents[2]
        config = Config(str(backend / "alembic.ini"))
        config.set_main_option("script_location", str(backend / "alembic"))
        command.upgrade(config, "head")
        clear_caches()
    return database_url


@pytest.fixture
def auth_client(migrated_auth_database, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", migrated_auth_database)
    monkeypatch.setenv("AUTH_ALLOWED_ORIGINS", '["http://localhost:5173"]')
    monkeypatch.setenv("REFRESH_COOKIE_SECURE", "false")
    clear_caches()
    try:
        with TestClient(create_app(), headers=CSRF_HEADERS) as client:
            yield client
    finally:
        clear_caches()


@pytest.fixture
def registration():
    return {
        "email": f"learner-{uuid4().hex}@example.com",
        "full_name": "Test Learner",
        "password": f"Ab9!{secrets.token_urlsafe(24)}",
    }


@pytest.fixture
def account(auth_client, registration):
    response = auth_client.post("/api/v1/auth/register", json=registration)
    assert response.status_code == 201
    return {**registration, "id": response.json()["id"]}


@pytest.fixture
def logged_in(auth_client, account):
    response = auth_client.post(
        "/api/v1/auth/login",
        json={"email": account["email"], "password": account["password"]},
    )
    assert response.status_code == 200
    return {"account": account, "access_token": response.json()["access_token"]}
