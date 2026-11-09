"""Explicit interactive provisioning of one new instructor on a verified production target."""

import argparse
import getpass
import sys
import warnings
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import create_engine, pool
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session

from app.auth.schemas import RegisterRequest
from app.auth.service import EmailAlreadyRegistered, register_user
from app.core.config import Settings, get_settings
from app.import_demo_courses import CONFIRMATION, ImportRefused, _check_schema, _guard_target


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.exit(2, "Invalid instructor provisioning arguments; use --help.\n")


def _provision(settings: Settings, url: URL, payload: RegisterRequest) -> UUID:
    engine = create_engine(
        url,
        poolclass=pool.NullPool,
        isolation_level="READ COMMITTED",
        hide_parameters=True,
        connect_args={"connect_timeout": settings.database_connect_timeout},
    )
    try:
        with engine.connect() as connection:
            with connection.begin():
                _check_schema(connection, url.database)
                # The service's commit/refresh stays inside this root transaction.
                with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                    user = register_user(db, payload, role="instructor")
                    instructor_id = UUID(str(user.id))
        return instructor_id
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--full-name", required=True)
    parser.add_argument("--expected-host", required=True)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--confirm-production-provisioning", required=True)
    args = parser.parse_args(argv)
    if args.confirm_production_provisioning != CONFIRMATION:
        parser.error("Explicit production project/branch attestation is required")
    try:
        settings = get_settings()
        url = _guard_target(settings, args.expected_host, args.expected_database)
    except ImportRefused as error:
        print(f"Instructor provisioning refused: {error}.", file=sys.stderr)
        return 1
    except Exception:
        print("Invalid production configuration; provisioning refused.", file=sys.stderr)
        return 1
    if not sys.stdin.isatty():
        print("An interactive terminal with hidden password input is required.", file=sys.stderr)
        return 1
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            password = getpass.getpass("Password: ")
            confirmation = getpass.getpass("Confirm password: ")
    except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
        print("Provisioning cancelled or hidden password input unavailable.", file=sys.stderr)
        return 1
    if password != confirmation:
        print("Passwords do not match; provisioning refused.", file=sys.stderr)
        return 1
    try:
        payload = RegisterRequest(email=args.email, full_name=args.full_name, password=password)
    except ValidationError:
        print("Identity or password validation failed; provisioning refused.", file=sys.stderr)
        return 1
    try:
        instructor_id = _provision(settings, url, payload)
    except EmailAlreadyRegistered:
        print(
            "Email already registered; existing accounts are never promoted or modified.",
            file=sys.stderr,
        )
        return 1
    except ImportRefused as error:
        print(f"Instructor provisioning refused: {error}.", file=sys.stderr)
        return 1
    except (Exception, KeyboardInterrupt):
        print(
            "Instructor provisioning failed or its commit could not be confirmed. "
            "Verify account existence read-only before retrying; no credentials are shown.",
            file=sys.stderr,
        )
        return 1
    print(instructor_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
