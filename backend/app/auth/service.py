from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import repository
from app.auth.models import RefreshSession, User
from app.auth.schemas import LoginRequest, RegisterRequest
from app.auth.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
    verify_unknown_password,
)
from app.core.config import Settings


class AuthenticationFailed(Exception):
    pass


class EmailAlreadyRegistered(Exception):
    pass


def register_user(
    db: Session,
    payload: RegisterRequest,
    *,
    role: Literal["student", "admin"] = "student",
) -> User:
    if repository.user_by_email(db, str(payload.email)) is not None:
        raise EmailAlreadyRegistered
    user = User(
        email=str(payload.email),
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=role,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if repository.user_by_email(db, str(payload.email)) is not None:
            raise EmailAlreadyRegistered from error
        raise
    db.refresh(user)
    return user


def _new_refresh_session(db: Session, user: User, settings: Settings) -> str:
    token = generate_refresh_token()
    db.add(
        RefreshSession(
            user_id=user.id,
            token_hash=hash_refresh_token(token),
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
        )
    )
    return token


def login(db: Session, payload: LoginRequest, settings: Settings) -> tuple[str, str]:
    user = repository.user_by_email(db, str(payload.email))
    if user is None:
        verify_unknown_password(payload.password)
        raise AuthenticationFailed
    if not verify_password(payload.password, user.password_hash) or not user.is_active:
        raise AuthenticationFailed
    access_token = create_access_token(user.id, settings)
    refresh_token = _new_refresh_session(db, user, settings)
    db.commit()
    return access_token, refresh_token


def refresh(db: Session, token: str, settings: Settings) -> tuple[str, str]:
    session = repository.lock_refresh_session(db, hash_refresh_token(token))
    now = datetime.now(UTC)
    if session is None or session.revoked_at is not None or session.expires_at <= now:
        raise AuthenticationFailed
    user = repository.user_by_id(db, session.user_id)
    if user is None or not user.is_active:
        raise AuthenticationFailed
    session.revoked_at = now
    new_token = _new_refresh_session(db, user, settings)
    access_token = create_access_token(user.id, settings)
    db.commit()
    return access_token, new_token


def logout(db: Session, token: str | None) -> None:
    if token:
        session = repository.lock_refresh_session(db, hash_refresh_token(token))
        if session is not None and session.revoked_at is None:
            session.revoked_at = datetime.now(UTC)
        db.commit()
