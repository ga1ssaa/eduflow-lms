from unittest.mock import MagicMock

from app.db.session import get_db


def test_database_session_context_closes_after_request(monkeypatch):
    session_context = MagicMock()
    session = session_context.__enter__.return_value
    session_factory = MagicMock(return_value=session_context)
    monkeypatch.setattr("app.db.session.get_session_factory", lambda: session_factory)

    dependency = get_db()
    assert next(dependency) is session
    dependency.close()

    session_context.__exit__.assert_called_once()
