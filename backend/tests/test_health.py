from unittest.mock import Mock

import pytest
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.db.session import get_db


def test_liveness_does_not_open_database(client, monkeypatch):
    def unexpected_database_call():
        pytest.fail("Liveness must not initialize a database connection")

    monkeypatch.setattr("app.db.session.get_engine", unexpected_database_call)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_database_health_executes_select_one_and_cleans_dependency(client):
    db = Mock()
    db.execute.return_value.scalar_one.return_value = 1
    closed = []

    def override_db():
        try:
            yield db
        finally:
            closed.append(True)

    client.app.dependency_overrides[get_db] = override_db
    response = client.get("/api/v1/health/db")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert str(db.execute.call_args.args[0]) == "SELECT 1"
    db.execute.return_value.scalar_one.assert_called_once_with()
    assert closed == [True]


@pytest.mark.parametrize(
    "error",
    [
        OperationalError("SELECT 1", {}, Exception("sensitive connection information")),
        SQLAlchemyError("sensitive database details"),
    ],
)
def test_database_failure_returns_safe_503(client, error):
    db = Mock()
    db.execute.side_effect = error
    closed = []

    def override_db():
        try:
            yield db
        finally:
            closed.append(True)

    client.app.dependency_overrides[get_db] = override_db
    response = client.get("/api/v1/health/db")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}
    assert "sensitive" not in response.text
    assert closed == [True]
