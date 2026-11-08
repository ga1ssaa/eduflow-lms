"""Fixture preparation safety checks; no database connections or provisioning."""

import sys
from pathlib import Path

import pytest

from testutils import prepare_e2e

TEST_URL = "postgresql+psycopg://tester@localhost/eduflow_test_guard"


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_URL)
    monkeypatch.setenv("TEST_DATABASE_URL", TEST_URL)
    monkeypatch.setenv("ENVIRONMENT", "test")

    def forbidden(*args, **kwargs):
        pytest.fail("Guard tests must not enter database or provisioning code")

    monkeypatch.setattr(prepare_e2e, "get_engine", forbidden)
    monkeypatch.setattr(prepare_e2e, "get_session_factory", forbidden)
    monkeypatch.setattr("app.db.session.create_engine", forbidden)


@pytest.mark.parametrize("missing", ["DATABASE_URL", "TEST_DATABASE_URL"])
def test_missing_explicit_database_url_is_refused(monkeypatch, missing):
    monkeypatch.delenv(missing)
    with pytest.raises(ValueError, match="explicitly equal"):
        prepare_e2e.guard_configuration()


def test_mismatched_test_database_url_is_refused(monkeypatch):
    monkeypatch.setenv("TEST_DATABASE_URL", TEST_URL + "_other")
    with pytest.raises(ValueError, match="explicitly equal"):
        prepare_e2e.guard_configuration()


@pytest.mark.parametrize("environment", ["development", "production", "", None])
def test_non_test_environment_is_refused(monkeypatch, environment):
    if environment is None:
        monkeypatch.delenv("ENVIRONMENT")
    else:
        monkeypatch.setenv("ENVIRONMENT", environment)
    with pytest.raises(ValueError, match="explicitly be test"):
        prepare_e2e.guard_configuration()


@pytest.mark.parametrize(
    "url",
    ["postgresql+psycopg://localhost/eduflow", "sqlite:///eduflow_test_guard"],
)
def test_non_disposable_database_is_refused(monkeypatch, url):
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("TEST_DATABASE_URL", url)
    with pytest.raises(ValueError, match="dedicated eduflow_test_"):
        prepare_e2e.guard_configuration()


@pytest.mark.parametrize(
    "query", ["dbname=production", "host=unexpected.example", "service=opaque"]
)
def test_query_routing_override_is_refused_before_preparation(monkeypatch, query):
    url = f"{TEST_URL}?{query}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("TEST_DATABASE_URL", url)
    with pytest.raises(ValueError, match="eduflow_test_"):
        prepare_e2e.guard_configuration()


@pytest.mark.parametrize("scheme", ["postgresql", "postgresql+psycopg"])
def test_valid_explicit_local_test_configuration_needs_no_connection(monkeypatch, scheme):
    url = f"{scheme}://tester@localhost/eduflow_test_guard"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("TEST_DATABASE_URL", url)
    settings = prepare_e2e.guard_configuration()
    assert settings.environment == "test"
    assert str(settings.database_url) == TEST_URL


def refuse_provisioning(monkeypatch):
    def forbidden():
        pytest.fail("Refused output must not enter fixture preparation")

    monkeypatch.setattr(prepare_e2e, "prepare", forbidden)


def test_existing_output_is_never_overwritten(tmp_path, monkeypatch, capsys):
    path = tmp_path / "private-fixture.json"
    path.write_text("existing fixture sentinel", encoding="utf-8")
    refuse_provisioning(monkeypatch)
    monkeypatch.setattr(sys, "argv", ["prepare_e2e", "--output", str(path)])
    assert prepare_e2e.main() == 1
    assert path.read_text(encoding="utf-8") == "existing fixture sentinel"
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "refused or failed" in captured.err
    assert TEST_URL not in captured.err


def test_repository_output_is_refused_without_creating_file(monkeypatch):
    path = Path(__file__).resolve().parents[2] / "forbidden-e2e-fixture.json"
    assert not path.exists()
    refuse_provisioning(monkeypatch)
    monkeypatch.setattr(sys, "argv", ["prepare_e2e", "--output", str(path)])
    assert prepare_e2e.main() == 1
    assert not path.exists()


def test_relative_output_is_refused_without_creating_file(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    refuse_provisioning(monkeypatch)
    monkeypatch.setattr(sys, "argv", ["prepare_e2e", "--output", "private-fixture.json"])
    assert prepare_e2e.main() == 1
    assert not (tmp_path / "private-fixture.json").exists()
