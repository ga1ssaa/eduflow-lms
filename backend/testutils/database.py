"""Fail-closed routing checks for disposable PostgreSQL test databases."""

import os
import re
from collections.abc import Mapping

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

_REQUIREMENT = (
    "A dedicated eduflow_test_* PostgreSQL database with explicit host and user is required"
)
_SAFE_QUERY_OPTIONS = {"sslmode", "connect_timeout"}
_LIBPQ_ROUTING_DEFAULTS = {
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
}


def guard_test_database_url(raw: str, *, environ: Mapping[str, str] | None = None) -> URL:
    """Validate the effective routing boundary without resolving or connecting to a host.

    SQLAlchemy query parameters override URL authority/path fields, and libpq can
    fill missing parameters from services/environment. Require explicit identity
    and allow only the two non-routing query options used by the test harness.
    """
    try:
        url = make_url(raw)
    except (ArgumentError, TypeError, ValueError):
        raise ValueError(_REQUIREMENT) from None
    if (
        url.drivername not in {"postgresql", "postgresql+psycopg"}
        or not url.host
        or not url.username
        or not url.database
        or not re.fullmatch(r"eduflow_test_[A-Za-z0-9_-]+", url.database)
        or len(url.database) > 63
        or (url.port is not None and not 1 <= url.port <= 65535)
        or any(character.isspace() or character in ",=/\\" for character in url.host)
    ):
        raise ValueError(_REQUIREMENT)
    if any(
        key not in _SAFE_QUERY_OPTIONS or not isinstance(value, str)
        for key, value in url.query.items()
    ):
        raise ValueError(
            f"{_REQUIREMENT}; query options must be limited to sslmode/connect_timeout"
        )
    environment = os.environ if environ is None else environ
    if any(key.upper() in _LIBPQ_ROUTING_DEFAULTS and value for key, value in environment.items()):
        raise ValueError(f"{_REQUIREMENT}; libpq routing defaults must be unset")
    return url
