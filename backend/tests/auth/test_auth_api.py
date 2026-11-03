from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.session import get_session_factory

pytestmark = pytest.mark.integration
AUTH = "/api/v1/auth"
COOKIE = "eduflow_refresh"


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_normalizes_identity_and_persists_hash(auth_client, registration):
    from app.auth.models import User
    from app.auth.security import verify_password

    registration["email"] = f"  {registration['email'].upper()}  "
    registration["full_name"] = "  Test Learner  "
    response = auth_client.post(f"{AUTH}/register", json=registration)
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == registration["email"].strip().lower()
    assert body["full_name"] == "Test Learner"
    assert body["role"] == "student"
    assert body["is_active"] is True
    assert not {"password", "password_hash", "token_hash"} & body.keys()
    with get_session_factory()() as db:
        user = db.scalar(select(User).where(User.email == body["email"]))
        assert user is not None
        assert user.password_hash != registration["password"]
        assert verify_password(registration["password"], user.password_hash)
    assert auth_client.post(f"{AUTH}/register", json=registration).status_code == 409


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("password", "short1!"),
        ("password", "a" * 12),
        ("password", "1" * 12),
        ("password", "a1" * 65),
        ("email", "invalid-address"),
        ("full_name", " "),
        ("role", "admin"),
    ],
)
def test_registration_rejects_invalid_or_privileged_input(auth_client, registration, field, value):
    registration[field] = value
    response = auth_client.post(f"{AUTH}/register", json=registration)
    assert response.status_code == 422
    assert registration["password"] not in response.text


@pytest.mark.parametrize("length", [12, 128])
def test_password_length_boundaries(auth_client, registration, length):
    registration["password"] = "Ab1!" + "x" * (length - 4)
    assert auth_client.post(f"{AUTH}/register", json=registration).status_code == 201
    assert (
        auth_client.post(
            f"{AUTH}/login",
            json={"email": registration["email"], "password": registration["password"]},
        ).status_code
        == 200
    )


def test_concurrent_registration_preserves_unique_email(auth_client, registration):
    from threading import Barrier

    barrier = Barrier(2)

    def register():
        with TestClient(auth_client.app, headers=dict(auth_client.headers)) as client:
            barrier.wait(timeout=10)
            return client.post(f"{AUTH}/register", json=registration).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: register(), range(2)))
    assert sorted(results) == [201, 409]


def test_login_me_cookie_and_unknown_credentials(auth_client, logged_in):
    response = auth_client.post(
        f"{AUTH}/login",
        json={
            "email": logged_in["account"]["email"],
            "password": logged_in["account"]["password"],
        },
    )
    assert response.status_code == 200
    assert set(response.json()) == {"access_token", "token_type", "expires_in"}
    assert response.json()["token_type"] == "bearer"
    assert response.json()["expires_in"] > 0
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "path=/api/v1/auth" in cookie
    assert "samesite=lax" in cookie
    profile = auth_client.get("/api/v1/users/me", headers=bearer(response.json()["access_token"]))
    assert profile.status_code == 200
    assert profile.json()["id"] == logged_in["account"]["id"]
    assert "password_hash" not in profile.json()
    bad = {"email": logged_in["account"]["email"], "password": "Wrong-password-123!"}
    wrong = auth_client.post(f"{AUTH}/login", json=bad)
    bad["email"] = "missing-account@example.com"
    missing = auth_client.post(f"{AUTH}/login", json=bad)
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


@pytest.mark.parametrize("authorization", [None, "Basic invalid", "Bearer invalid"])
def test_me_requires_valid_bearer(auth_client, authorization):
    headers = {} if authorization is None else {"Authorization": authorization}
    assert auth_client.get("/api/v1/users/me", headers=headers).status_code == 401


def test_refresh_without_cookie_is_unauthorized(auth_client):
    assert auth_client.post(f"{AUTH}/refresh").status_code == 401


@pytest.mark.parametrize("route", ["register", "login", "refresh", "logout"])
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "http://localhost:5173"},
        {"X-CSRF-Token": "1"},
        {"Origin": "http://localhost:5173.evil.example", "X-CSRF-Token": "1"},
        {"Origin": "null", "X-CSRF-Token": "1"},
        {"Origin": "http://localhost:5173", "X-CSRF-Token": "0"},
    ],
)
def test_mutations_require_exact_origin_and_csrf(auth_client, route, headers):
    with TestClient(auth_client.app) as untrusted:
        response = untrusted.post(f"{AUTH}/{route}", json={}, headers=headers)
    assert response.status_code == 403


def test_refresh_rotates_and_logout_revokes_cookie(auth_client, logged_in):
    original = auth_client.cookies.get(COOKIE)
    response = auth_client.post(f"{AUTH}/refresh")
    assert response.status_code == 200
    rotated = auth_client.cookies.get(COOKIE)
    assert rotated and rotated != original
    assert (
        auth_client.get(
            "/api/v1/users/me", headers=bearer(response.json()["access_token"])
        ).status_code
        == 200
    )
    with TestClient(auth_client.app, headers=dict(auth_client.headers)) as stale:
        stale.cookies.set(COOKIE, original, path=AUTH)
        assert stale.post(f"{AUTH}/refresh").status_code == 401
    logout = auth_client.post(f"{AUTH}/logout")
    assert logout.status_code == 204
    assert "max-age=0" in logout.headers["set-cookie"].lower()
    assert auth_client.cookies.get(COOKIE) is None
    assert (
        auth_client.get("/api/v1/users/me", headers=bearer(logged_in["access_token"])).status_code
        == 200
    )
    assert auth_client.post(f"{AUTH}/logout").status_code == 204
    auth_client.cookies.set(COOKIE, rotated, path=AUTH)
    assert auth_client.post(f"{AUTH}/refresh").status_code == 401


def test_only_one_concurrent_refresh_succeeds(auth_client, logged_in):
    from threading import Barrier

    original = auth_client.cookies.get(COOKIE)
    barrier = Barrier(2)

    def refresh():
        with TestClient(auth_client.app, headers=dict(auth_client.headers)) as client:
            client.cookies.set(COOKIE, original, path=AUTH)
            barrier.wait(timeout=10)
            return client.post(f"{AUTH}/refresh").status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: refresh(), range(2)))
    assert sorted(results) == [200, 401]


@pytest.mark.parametrize("expired", [True, False])
def test_expired_or_revoked_refresh_is_rejected(auth_client, logged_in, expired):
    from app.auth.models import RefreshSession
    from app.auth.security import hash_refresh_token

    with get_session_factory()() as db:
        session = db.scalar(
            select(RefreshSession).where(
                RefreshSession.token_hash == hash_refresh_token(auth_client.cookies.get(COOKIE))
            )
        )
        assert session is not None
        if expired:
            session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        else:
            session.revoked_at = datetime.now(UTC)
        db.commit()
    assert auth_client.post(f"{AUTH}/refresh").status_code == 401


def test_role_checks_use_current_database_state(auth_client, logged_in):
    from app.auth.dependencies import require_role
    from app.auth.models import User

    for role in ("student", "instructor", "admin"):
        auth_client.app.add_api_route(
            f"/test-only/{role}",
            lambda: {"allowed": True},
            dependencies=[Depends(require_role(role))],
        )
    headers = bearer(logged_in["access_token"])
    for assigned in ("student", "instructor", "admin"):
        with get_session_factory()() as db:
            user = db.scalar(select(User).where(User.email == logged_in["account"]["email"]))
            user.role = assigned
            db.commit()
        for required in ("student", "instructor", "admin"):
            response = auth_client.get(f"/test-only/{required}", headers=headers)
            assert response.status_code == (200 if assigned == required else 403)
    with get_session_factory()() as db:
        user = db.scalar(select(User).where(User.email == logged_in["account"]["email"]))
        user.is_active = False
        db.commit()
    assert auth_client.get("/api/v1/users/me", headers=headers).status_code == 401
    assert auth_client.get("/test-only/admin", headers=headers).status_code == 401
    assert auth_client.post(f"{AUTH}/refresh").status_code == 401
    assert (
        auth_client.post(
            f"{AUTH}/login",
            json={
                "email": logged_in["account"]["email"],
                "password": logged_in["account"]["password"],
            },
        ).status_code
        == 401
    )


def test_bootstrap_admin_persists_and_refuses_duplicate(
    auth_client, registration, monkeypatch, capsys
):
    from app import cli
    from app.auth.models import User

    monkeypatch.setattr(
        "sys.argv",
        ["eduflow", "create-admin", "--email", registration["email"], "--full-name", "Test Admin"],
    )
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: registration["password"])
    assert cli.main() == 0
    assert cli.main() == 1
    with get_session_factory()() as db:
        user = db.scalar(select(User).where(User.email == registration["email"]))
        assert user.role == "admin"
        assert user.is_active
    captured = capsys.readouterr()
    assert registration["password"] not in captured.out + captured.err


def test_browser_preflight_allows_only_explicit_origins(auth_client):
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-token",
    }
    response = auth_client.options(f"{AUTH}/login", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == headers["Origin"]
    assert response.headers["access-control-allow-credentials"] == "true"
    headers["Origin"] = "https://untrusted.example.com"
    response = auth_client.options(f"{AUTH}/login", headers=headers)
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_secure_cookie_round_trip_and_clearing(auth_client, account, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("REFRESH_COOKIE_SECURE", "true")
    get_settings.cache_clear()
    with TestClient(
        auth_client.app, base_url="https://testserver", headers=dict(auth_client.headers)
    ) as browser:
        response = browser.post(
            f"{AUTH}/login", json={"email": account["email"], "password": account["password"]}
        )
        assert response.status_code == 200
        assert "; secure" in response.headers["set-cookie"].lower()
        assert browser.post(f"{AUTH}/refresh").status_code == 200
        response = browser.post(f"{AUTH}/logout")
        assert response.status_code == 204
        assert "; secure" in response.headers["set-cookie"].lower()
        assert browser.cookies.get(COOKIE) is None
