"""Explicit, guarded production demo import; never invoked by application startup."""

import argparse
import io
import os
import re
import sys
from contextlib import redirect_stdout
from uuid import UUID

from sqlalchemy import create_engine, pool, text
from sqlalchemy.engine import URL, Connection, make_url
from sqlalchemy.orm import Session

from app import seed_demo_courses as seed
from app.core.config import Settings, get_settings

CONFIRMATION = "eduflow-production/production"  # Operator attests project/branch, not database.
_ROUTING_ENV = {
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


class ImportRefused(ValueError):
    """An import prerequisite was not satisfied."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        # Never echo a malformed argument that might contain a pasted credential.
        self.exit(2, "Invalid production import arguments; use --help.\n")


def _guard_target(settings: Settings, expected_host: str, expected_database: str) -> URL:
    url = make_url(str(settings.database_url))
    host = (url.host or "").lower()
    if (
        settings.environment != "production"
        or url.drivername != "postgresql+psycopg"
        or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech", host)
        or "-pooler" in host
        or host != expected_host.lower()
        or not url.database
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,63}", url.database)
        or url.database != expected_database
        or not url.username
        or not url.password
        or url.port not in {None, 5432}
    ):
        raise ImportRefused("Production target verification failed")
    if any(
        key not in {"sslmode", "channel_binding", "connect_timeout"} or not isinstance(value, str)
        for key, value in url.query.items()
    ):
        raise ImportRefused("Ambiguous connection options are forbidden")
    if not (
        url.query.get("sslmode") == "verify-full"
        or (url.query.get("sslmode") == "require" and url.query.get("channel_binding") == "require")
    ):
        raise ImportRefused("Verified production TLS parameters are required")
    if any(key.upper() in _ROUTING_ENV and value for key, value in os.environ.items()):
        raise ImportRefused("Libpq routing defaults must be unset")
    return url


def _check_schema(connection: Connection, expected_database: str) -> None:
    database, schema, path = connection.execute(
        text("SELECT current_database(), current_schema(), current_schemas(false)")
    ).one()
    if database != expected_database or schema != "public" or list(path) != ["public"]:
        raise ImportRefused("Effective database or schema differs from the expected target")
    revisions = list(
        connection.execute(text("SELECT version_num FROM public.alembic_version")).scalars()
    )
    if revisions != ["0004_learning"]:
        raise ImportRefused("Schema must already be at 0004_learning")


def _seed_transaction(
    connection: Connection,
    manifest: seed.DemoManifest,
    instructor_id: UUID,
    expected_database: str,
    *,
    apply: bool,
) -> tuple[int, int]:
    _check_schema(connection, expected_database)
    # Existing publication commits release savepoints; only the caller owns the root commit.
    with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
        return seed.seed_courses(db, manifest, instructor_id, apply=apply)


def _run_import(
    settings: Settings,
    url: URL,
    manifest: seed.DemoManifest,
    instructor_id: UUID,
    *,
    apply: bool,
) -> tuple[int, int]:
    engine = create_engine(
        url,
        poolclass=pool.NullPool,
        isolation_level="READ COMMITTED",
        hide_parameters=True,
        connect_args={"connect_timeout": settings.database_connect_timeout},
    )
    try:
        with engine.connect() as connection:
            if apply:
                with connection.begin():
                    return _seed_transaction(
                        connection, manifest, instructor_id, url.database, apply=True
                    )
            transaction = connection.begin()
            try:
                # This must precede schema inspection, Session construction, and seed queries.
                connection.exec_driver_sql("SET TRANSACTION READ ONLY")
                return _seed_transaction(
                    connection, manifest, instructor_id, url.database, apply=False
                )
            finally:
                transaction.rollback()
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(description=__doc__)
    parser.add_argument("--instructor-id", type=UUID, required=True)
    parser.add_argument("--expected-host", required=True)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--confirm-production-import")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    if args.apply and args.confirm_production_import != CONFIRMATION:
        parser.error("Production project/branch attestation is required for apply")
    try:
        settings = get_settings()
        url = _guard_target(settings, args.expected_host, args.expected_database)
        manifest = seed.load_manifest()
        # CLI-only capture: no per-course success is exposed before the outer commit.
        with redirect_stdout(io.StringIO()):
            created, skipped = _run_import(
                settings, url, manifest, args.instructor_id, apply=args.apply
            )
    except (ImportRefused, seed.SeedConflict) as error:
        print(
            f"Production demo import refused: {error}. Existing records were not overwritten.",
            file=sys.stderr,
        )
        return 1
    except (Exception, KeyboardInterrupt):
        print(
            "Production demo import refused or failed. Existing records are never overwritten. "
            "Verify the outcome with a read-only dry run before retrying; "
            "no credentials are shown.",
            file=sys.stderr,
        )
        return 1
    label = "created" if args.apply else "would_create"
    outcome = "Import committed." if args.apply else "Read-only inspection; nothing changed."
    print(
        f"{label}={created}, skipped={skipped}. Demo manifest: 8 courses, 21 modules, 63 lessons. "
        f"{outcome}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
