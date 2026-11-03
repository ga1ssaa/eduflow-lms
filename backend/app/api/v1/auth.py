from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.dependencies import authentication_required, require_csrf
from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserRead
from app.core.config import Settings, get_settings
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(require_csrf)])
COOKIE_PATH = "/api/v1/auth"
Db = Annotated[Session, Depends(get_db)]
Config = Annotated[Settings, Depends(get_settings)]


def set_refresh_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        max_age=settings.refresh_token_days * 86400,
        path=COOKIE_PATH,
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )


def clear_refresh_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path=COOKIE_PATH,
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )


def token_response(
    response: Response, access: str, refresh: str, settings: Settings
) -> TokenResponse:
    set_refresh_cookie(response, refresh, settings)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return TokenResponse(access_token=access, expires_in=settings.access_token_minutes * 60)


@router.post("/register", response_model=UserRead, status_code=201)
def register(payload: RegisterRequest, db: Db) -> UserRead:
    try:
        user = service.register_user(db, payload)
    except service.EmailAlreadyRegistered as error:
        raise HTTPException(status_code=409, detail="Email already registered") from error
    return UserRead.model_validate(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, response: Response, db: Db, settings: Config) -> TokenResponse:
    try:
        access, refresh = service.login(db, payload, settings)
    except service.AuthenticationFailed as error:
        raise authentication_required() from error
    return token_response(response, access, refresh, settings)


@router.post("/refresh", response_model=TokenResponse)
def refresh(request: Request, response: Response, db: Db, settings: Config) -> TokenResponse:
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token or len(token) > 256:
        raise authentication_required()
    try:
        access, refresh = service.refresh(db, token, settings)
    except service.AuthenticationFailed as error:
        raise authentication_required() from error
    return token_response(response, access, refresh, settings)


@router.post("/logout", status_code=204)
def logout(request: Request, db: Db, settings: Config) -> Response:
    token = request.cookies.get(settings.refresh_cookie_name)
    service.logout(db, token if token and len(token) <= 256 else None)
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    clear_refresh_cookie(response, settings)
    return response
