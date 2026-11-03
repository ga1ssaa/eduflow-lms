from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.repository import user_by_id
from app.auth.security import decode_access_token
from app.core.config import Settings, get_settings
from app.db.session import get_db

_bearer = HTTPBearer(auto_error=False)


def authentication_required() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication failed",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_csrf(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    csrf_marker: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> None:
    if request.headers.get("origin") not in settings.auth_allowed_origins or csrf_marker != "1":
        raise HTTPException(status_code=403, detail="CSRF validation failed")


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    if credentials is None:
        raise authentication_required()
    try:
        user_id = decode_access_token(credentials.credentials, settings)
    except jwt.InvalidTokenError as error:
        raise authentication_required() from error
    user = user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise authentication_required()
    return user


def require_role(*roles: str) -> Callable[..., User]:
    if not roles or any(role not in {"student", "instructor", "admin"} for role in roles):
        raise ValueError("At least one valid role must be specified")

    def check_role(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return check_role
