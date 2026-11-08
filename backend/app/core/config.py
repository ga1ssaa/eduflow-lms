from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, PostgresDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True
    )

    database_url: PostgresDsn
    database_connect_timeout: int = Field(default=5, ge=1, le=60)
    cors_origins: list[str] = Field(default_factory=list)
    jwt_secret: SecretStr = Field(min_length=32)
    jwt_issuer: str = Field(default="eduflow", min_length=1)
    access_token_minutes: int = Field(default=15, ge=1, le=1440)
    refresh_token_days: int = Field(default=7, ge=1, le=365)
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    refresh_cookie_name: str = Field(default="eduflow_refresh", pattern=r"^[A-Za-z0-9_-]+$")
    environment: Literal["development", "test", "production"] = "development"
    auth_allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8000",
        ]
    )

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, secret: SecretStr) -> SecretStr:
        if len(secret.get_secret_value().strip()) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 non-padding characters")
        return secret

    @field_validator("cors_origins", "auth_allowed_origins")
    @classmethod
    def validate_origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                "*" in origin
                or parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("Origins must be explicit HTTP(S) origins without paths")
        return origins

    @model_validator(mode="after")
    def validate_cookie_security(self) -> "Settings":
        if self.environment == "production" and not self.refresh_cookie_secure:
            raise ValueError("Production requires REFRESH_COOKIE_SECURE=true")
        if self.environment == "production" and any(
            urlsplit(origin).scheme != "https"
            for origin in self.cors_origins + self.auth_allowed_origins
        ):
            raise ValueError("Production requires HTTPS origins")
        if self.refresh_cookie_samesite == "none" and not self.refresh_cookie_secure:
            raise ValueError("SameSite=None requires REFRESH_COOKIE_SECURE=true")
        return self

    @field_validator("database_url", mode="before")
    @classmethod
    def use_sync_psycopg(cls, value: object) -> object:
        if isinstance(value, str):
            if value.startswith("postgres://"):
                return value.replace("postgres://", "postgresql+psycopg://", 1)
            if value.startswith("postgresql://"):
                return value.replace("postgresql://", "postgresql+psycopg://", 1)
            if not value.startswith("postgresql+psycopg://"):
                raise ValueError("DATABASE_URL must use postgres, postgresql or postgresql+psycopg")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
