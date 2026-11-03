from functools import lru_cache

from pydantic import Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: PostgresDsn
    database_connect_timeout: int = Field(default=5, ge=1, le=60)
    cors_origins: list[str] = Field(default_factory=list)

    @field_validator("database_url", mode="before")
    @classmethod
    def use_sync_psycopg(cls, value: object) -> object:
        if isinstance(value, str):
            if value.startswith("postgresql://"):
                return value.replace("postgresql://", "postgresql+psycopg://", 1)
            if not value.startswith("postgresql+psycopg://"):
                raise ValueError("DATABASE_URL must use postgresql or postgresql+psycopg")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
