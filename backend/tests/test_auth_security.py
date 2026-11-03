import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from pydantic import ValidationError

from app.auth.security import (
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.core.config import Settings


@pytest.fixture
def security_settings():
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test@localhost/test",
        jwt_secret=secrets.token_urlsafe(48),
    )


def test_password_hashes_are_salted_and_verifiable():
    password = secrets.token_urlsafe(24)
    first, second = hash_password(password), hash_password(password)
    assert first != second
    assert password not in first
    assert verify_password(password, first)
    assert not verify_password(secrets.token_urlsafe(24), first)
    assert not verify_password(password, "malformed-hash")


def test_access_token_round_trip(security_settings):
    user_id = uuid4()
    token = create_access_token(user_id, security_settings)
    assert decode_access_token(token, security_settings) == user_id
    claims = jwt.decode(
        token,
        security_settings.jwt_secret.get_secret_value(),
        algorithms=["HS256"],
        issuer=security_settings.jwt_issuer,
    )
    assert claims["sub"] == str(user_id)
    assert claims["type"] == "access"
    assert claims["exp"] - claims["iat"] == security_settings.access_token_minutes * 60


@pytest.mark.parametrize(
    "mutation",
    [
        "expired",
        "future_iat",
        "issuer",
        "type",
        "subject",
        "signature",
        "algorithm",
        "missing_sub",
        "missing_exp",
        "missing_iat",
        "missing_iss",
        "missing_type",
    ],
)
def test_access_token_rejects_invalid_claims(security_settings, mutation):
    now = datetime.now(UTC)
    claims = {
        "sub": str(uuid4()),
        "iss": security_settings.jwt_issuer,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    key = security_settings.jwt_secret.get_secret_value()
    algorithm = "HS256"
    if mutation.startswith("missing_"):
        claims.pop(mutation.removeprefix("missing_"))
    elif mutation == "expired":
        claims["exp"] = now - timedelta(minutes=1)
    elif mutation == "future_iat":
        claims["iat"] = now + timedelta(hours=1)
    elif mutation == "issuer":
        claims["iss"] = "untrusted-issuer"
    elif mutation == "type":
        claims["type"] = "refresh"
    elif mutation == "subject":
        claims["sub"] = "invalid-uuid"
    elif mutation == "signature":
        key = secrets.token_urlsafe(48)
    elif mutation == "algorithm":
        algorithm = "HS384"
    token = jwt.encode(claims, key, algorithm=algorithm)
    with pytest.raises((ValueError, jwt.InvalidTokenError)):
        decode_access_token(token, security_settings)


def test_refresh_tokens_have_random_material_and_only_digest_is_stored():
    first, second = generate_refresh_token(), generate_refresh_token()
    assert len(first) >= 43
    assert first != second
    assert hash_refresh_token(first) == hash_refresh_token(first)
    assert hash_refresh_token(first) != hash_refresh_token(second)
    assert first not in hash_refresh_token(first)


def test_jwt_secret_is_required(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(ValidationError, match="jwt_secret"):
        Settings(_env_file=None, database_url="postgresql+psycopg://test@localhost/test")


@pytest.mark.parametrize("secret", ["", "short", " " * 48])
def test_jwt_secret_rejects_weak_values(secret):
    with pytest.raises(ValidationError, match="jwt_secret"):
        Settings(
            _env_file=None,
            database_url="postgresql+psycopg://test@localhost/test",
            jwt_secret=secret,
        )


def test_production_cookie_and_origin_guards(security_settings):
    values = {
        "database_url": security_settings.database_url,
        "jwt_secret": security_settings.jwt_secret,
        "environment": "production",
        "cors_origins": ["https://learn.example.com"],
        "auth_allowed_origins": ["https://learn.example.com"],
    }
    with pytest.raises(ValidationError, match="REFRESH_COOKIE_SECURE"):
        Settings(_env_file=None, **values, refresh_cookie_secure=False)
    assert Settings(_env_file=None, **values, refresh_cookie_secure=True)
    values["auth_allowed_origins"] = ["http://learn.example.com"]
    with pytest.raises(ValidationError, match="HTTPS origins"):
        Settings(_env_file=None, **values, refresh_cookie_secure=True)


def test_cross_site_cookie_requires_secure(security_settings):
    with pytest.raises(ValidationError, match="SameSite=None"):
        Settings(
            _env_file=None,
            database_url=security_settings.database_url,
            jwt_secret=security_settings.jwt_secret,
            refresh_cookie_samesite="none",
            refresh_cookie_secure=False,
        )


@pytest.mark.parametrize("field", ["cors_origins", "auth_allowed_origins"])
@pytest.mark.parametrize("origin", ["*", "https://*.example.com", "null", "https://a.com/path"])
def test_origins_cannot_be_wildcards_or_paths(security_settings, field, origin):
    with pytest.raises(ValidationError, match="Origins must be explicit"):
        Settings(
            _env_file=None,
            database_url=security_settings.database_url,
            jwt_secret=security_settings.jwt_secret,
            **{field: [origin]},
        )
