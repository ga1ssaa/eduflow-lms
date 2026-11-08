import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None)


def test_settings_load_dotenv(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_CONNECT_TIMEOUT", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "DATABASE_URL=postgresql://test@localhost/test\n"
        "DATABASE_CONNECT_TIMEOUT=7\n"
        'CORS_ORIGINS=["http://localhost:5173"]\n'
        "UNRELATED_FRONTEND_SETTING=ignored\n"
    )
    settings = Settings(_env_file=env_file)
    assert str(settings.database_url) == "postgresql+psycopg://test@localhost/test"
    assert settings.database_connect_timeout == 7
    assert settings.cors_origins == ["http://localhost:5173"]


def test_environment_overrides_dotenv(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URL=postgresql://file@localhost/test\n")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://environment@localhost/test")
    settings = Settings(_env_file=env_file)
    assert str(settings.database_url) == "postgresql+psycopg://environment@localhost/test"


def test_heroku_postgres_url_preserves_ssl_query_parameters():
    settings = Settings(
        _env_file=None,
        database_url=(
            "postgres://test@database.example.com/eduflow_test_config"
            "?sslmode=require&connect_timeout=7"
        ),
    )
    assert str(settings.database_url) == (
        "postgresql+psycopg://test@database.example.com/eduflow_test_config"
        "?sslmode=require&connect_timeout=7"
    )


@pytest.mark.parametrize("hostname", ["ep-example.neon.tech", "ep-example-pooler.neon.tech"])
def test_neon_production_urls_preserve_tls_and_channel_binding(hostname):
    settings = Settings(
        _env_file=None,
        database_url=(
            f"postgresql://test@{hostname}/eduflow?sslmode=require&channel_binding=require"
        ),
        environment="production",
        refresh_cookie_secure=True,
        refresh_cookie_samesite="lax",
        auth_allowed_origins=["https://eduflow.example"],
        cors_origins=["https://eduflow.example"],
    )
    assert str(settings.database_url) == (
        f"postgresql+psycopg://test@{hostname}/eduflow?sslmode=require&channel_binding=require"
    )


@pytest.mark.parametrize("url", ["sqlite:///test.db", "postgresql+asyncpg://test@localhost/test"])
def test_settings_reject_unsupported_database_driver(url):
    with pytest.raises(ValidationError, match="DATABASE_URL must use"):
        Settings(_env_file=None, database_url=url)


@pytest.mark.parametrize("timeout", [0, 61])
def test_connect_timeout_is_bounded(timeout):
    with pytest.raises(ValidationError, match="database_connect_timeout"):
        Settings(
            _env_file=None,
            database_url="postgresql+psycopg://test@localhost/test",
            database_connect_timeout=timeout,
        )
