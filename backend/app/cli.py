"""Explicit, interactive account provisioning; never run during application startup."""

import argparse
import getpass
import sys
import warnings

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.auth.schemas import RegisterRequest
from app.auth.service import EmailAlreadyRegistered, register_user
from app.db.session import get_session_factory


def main() -> int:
    parser = argparse.ArgumentParser(description="EduFlow account administration")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-admin", help="Create a new administrator account")
    create.add_argument("--email", required=True)
    create.add_argument("--full-name", required=True)
    args = parser.parse_args()
    if not sys.stdin.isatty():
        print("An interactive terminal is required for the password prompt.", file=sys.stderr)
        return 1
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            password = getpass.getpass("Password: ")
            confirmation = getpass.getpass("Confirm password: ")
    except getpass.GetPassWarning:
        print("A terminal with hidden password input is required.", file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt):
        print("\nAccount creation cancelled.", file=sys.stderr)
        return 1
    if password != confirmation:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    try:
        payload = RegisterRequest(email=args.email, full_name=args.full_name, password=password)
    except ValidationError as error:
        for item in error.errors():
            print(f"{item['loc'][0]}: {item['msg']}", file=sys.stderr)
        return 1
    try:
        with get_session_factory()() as db:
            register_user(db, payload, role="admin")
    except EmailAlreadyRegistered:
        print("Email already registered; existing accounts are never promoted.", file=sys.stderr)
        return 1
    except SQLAlchemyError:
        print("Account creation failed: database unavailable or invalid schema.", file=sys.stderr)
        return 1
    print("Administrator account created.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
