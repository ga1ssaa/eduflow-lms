"""Disposable database routing regressions; never connect to a database."""

from urllib.parse import quote

import pytest
from sqlalchemy.dialects.postgresql.psycopg import PGDialect_psycopg

from testutils.database import guard_test_database_url

SAFE_URL = "postgresql+psycopg://tester@localhost:5432/eduflow_test_guard"


@pytest.mark.parametrize(
    "query",
    [
        "dbname=production",
        "database=production",
        "host=unexpected.example",
        "hostaddr=192.0.2.1",
        "port=6543",
        "user=unexpected",
        "password=unexpected",
        "service=opaque-profile",
        "servicefile=/tmp/opaque-service.conf",
        "passfile=/tmp/opaque-passfile",
        "DBNAME=production",
        "HoSt=unexpected.example",
        "SERVICE=opaque-profile",
        "%64bname=production",
        "sslmode=require&dbname=production",
        "host=localhost&host=unexpected.example",
        "sslmode=require&sslmode=disable",
        "options=-csearch_path%3Dunexpected",
    ],
)
def test_routing_and_opaque_query_parameters_are_rejected(query):
    with pytest.raises(ValueError, match="eduflow_test_"):
        guard_test_database_url(f"{SAFE_URL}?{query}", environ={})


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://tester@localhost/development",
        "postgresql+psycopg://tester@localhost/eduflow_test_",
        "postgresql+psycopg://tester@/eduflow_test_guard",
        "postgresql+psycopg://localhost/eduflow_test_guard",
        "postgresql+psycopg:///eduflow_test_guard",
        "sqlite:///eduflow_test_guard",
        "postgresql+asyncpg://tester@localhost/eduflow_test_guard",
        "postgresql+psycopg://tester@localhost,unexpected.example/eduflow_test_guard",
        "postgresql+psycopg://tester@localhost:0/eduflow_test_guard",
        "not a database URL",
    ],
)
def test_target_requires_explicit_supported_connection_identity(url):
    with pytest.raises(ValueError, match="eduflow_test_"):
        guard_test_database_url(url, environ={})


@pytest.mark.parametrize(
    "database",
    [
        "eduflow_test_guard dbname=production",
        "eduflow_test_guard?host=unexpected.example",
        "eduflow_test_guard/postgresql://unexpected.example/production",
        "eduflow_test_" + "a" * 64,
    ],
)
def test_database_identity_cannot_embed_conninfo_or_another_uri(database):
    url = "postgresql+psycopg://tester@localhost/" + quote(database, safe="")
    with pytest.raises(ValueError, match="eduflow_test_"):
        guard_test_database_url(url, environ={})


@pytest.mark.parametrize(
    "name",
    [
        "PGDATABASE",
        "PGHOST",
        "PGHOSTADDR",
        "PGPORT",
        "PGUSER",
        "PGPASSWORD",
        "PGPASSFILE",
        "PGSERVICE",
        "PGSERVICEFILE",
        "PGSYSCONFDIR",
        "PGOPTIONS",
        "PGTARGETSESSIONATTRS",
        "PGLOADBALANCEHOSTS",
        "pghost",
    ],
)
def test_libpq_routing_defaults_are_rejected(name):
    with pytest.raises(ValueError, match="libpq routing defaults"):
        guard_test_database_url(SAFE_URL, environ={name: "untrusted-default"})


def test_guard_checks_process_libpq_environment_by_default(monkeypatch):
    monkeypatch.setenv("PGSERVICE", "opaque-profile")
    with pytest.raises(ValueError, match="libpq routing defaults"):
        guard_test_database_url(SAFE_URL)


@pytest.mark.parametrize("scheme", ["postgresql", "postgresql+psycopg"])
@pytest.mark.parametrize(
    "query",
    ["", "?sslmode=require", "?connect_timeout=7", "?sslmode=require&connect_timeout=7"],
)
def test_explicit_test_target_and_ssl_timeout_options_preserve_routing(scheme, query):
    raw = f"{scheme}://tester@localhost:5432/eduflow_test_guard{query}"
    url = guard_test_database_url(raw, environ={})
    args, kwargs = PGDialect_psycopg().create_connect_args(url)
    assert not args
    assert kwargs["dbname"] == "eduflow_test_guard"
    assert kwargs["host"] == "localhost"
    assert kwargs["user"] == "tester"
    assert kwargs["port"] == 5432
    assert kwargs.get("sslmode") == ("require" if "sslmode" in query else None)
    assert kwargs.get("connect_timeout") == ("7" if "connect_timeout" in query else None)


def test_validation_error_never_includes_connection_credentials():
    raw = "postgresql+psycopg://tester:private-value@localhost/production"
    with pytest.raises(ValueError) as rejected:
        guard_test_database_url(raw, environ={})
    assert "private-value" not in str(rejected.value)
    assert raw not in str(rejected.value)
