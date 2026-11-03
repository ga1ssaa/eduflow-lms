import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import Settings

_password_hasher = PasswordHasher(type=Type.ID)
# The same password verification work is performed for unknown accounts.
_dummy_hash = _password_hasher.hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def verify_unknown_password(password: str) -> None:
    verify_password(password, _dummy_hash)


def create_access_token(user_id: UUID, settings: Settings) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user_id),
            "iss": settings.jwt_issuer,
            "iat": now,
            "exp": now + timedelta(minutes=settings.access_token_minutes),
            "type": "access",
        },
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def decode_access_token(token: str, settings: Settings) -> UUID:
    claims = jwt.decode(
        token,
        settings.jwt_secret.get_secret_value(),
        algorithms=["HS256"],
        issuer=settings.jwt_issuer,
        options={"require": ["sub", "iss", "iat", "exp", "type"]},
    )
    if claims["type"] != "access" or any(
        isinstance(claims[name], bool) or not isinstance(claims[name], (int, float))
        for name in ("iat", "exp")
    ):
        raise jwt.InvalidTokenError("Invalid access claims")
    try:
        return UUID(claims["sub"])
    except (ValueError, TypeError, AttributeError) as error:
        raise jwt.InvalidTokenError("Invalid subject") from error


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
