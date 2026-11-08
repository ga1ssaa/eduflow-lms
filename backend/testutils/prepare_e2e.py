"""Explicit fixture preparation for a fresh disposable full-stack QA database.

Run from backend with ``python -m testutils.prepare_e2e --output /private/tmp/....json``.
This utility never migrates, resets, deletes, or modifies existing records.
"""

import argparse
import json
import os
import secrets
import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.engine import make_url

from app.auth.schemas import RegisterRequest
from app.auth.security import create_access_token
from app.auth.service import register_user
from app.core.config import get_settings
from app.db.session import get_engine, get_session_factory
from app.main import create_app
from testutils.database import guard_test_database_url


def guard_configuration():
    raw = os.environ.get("DATABASE_URL")
    if not raw or raw != os.environ.get("TEST_DATABASE_URL"):
        raise ValueError("DATABASE_URL must explicitly equal TEST_DATABASE_URL")
    if os.environ.get("ENVIRONMENT") != "test":
        raise ValueError("ENVIRONMENT must explicitly be test")
    url = guard_test_database_url(raw)
    get_settings.cache_clear()
    settings = get_settings()
    expected = url.set(drivername="postgresql+psycopg")
    if settings.environment != "test" or make_url(str(settings.database_url)) != expected:
        raise ValueError("Effective backend settings differ from the guarded environment")
    return settings


def prepare() -> dict:
    settings = guard_configuration()
    # Refuse an unmigrated database; migrations belong to the invoking QA workflow.
    required = {
        "users",
        "refresh_sessions",
        "courses",
        "modules",
        "lessons",
        "enrollments",
        "lesson_progress",
        "alembic_version",
    }
    if not required.issubset(set(inspect(get_engine()).get_table_names())):
        raise ValueError("Apply the existing migrations before preparing fixtures")
    marker = uuid4().hex
    accounts = {}
    owner_id = None
    for role, name in (
        ("student", "Frontend Student"),
        ("instructor", "Frontend Instructor"),
        ("admin", "Frontend Administrator"),
    ):
        account = {
            "email": f"qa-{role}-{marker}@example.com",
            "password": f"Qa9!{secrets.token_urlsafe(24)}",
        }
        with get_session_factory()() as db:
            user = register_user(db, RegisterRequest(**account, full_name=name), role=role)
            if role == "instructor":
                owner_id = user.id
        accounts[role] = account
    category = f"Fullstack QA {marker}"
    search = f"Studio {marker}"
    token = create_access_token(owner_id, settings)
    with TestClient(create_app(), headers={"Authorization": f"Bearer {token}"}) as client:

        def post(path: str, payload: dict | None = None) -> dict:
            response = client.post(f"/api/v1/instructor/{path}", json=payload)
            if response.status_code not in {200, 201}:
                raise RuntimeError("Fixture authoring request failed")
            return response.json()

        def course(number: int, *, published: bool, primary: bool = False) -> dict:
            result = post(
                "courses",
                {
                    "title": f"{search} {'Foundations' if primary else number}",
                    "slug": f"qa-{marker}-{number}",
                    "description": "Disposable full-stack QA curriculum.",
                    "category": category,
                    "level": "beginner",
                },
            )
            module = post(f"courses/{result['id']}/modules", {"title": "Start here"})
            for position in range(1, 3 if primary else 2):
                post(
                    f"modules/{module['id']}/lessons",
                    {
                        "title": f"Lesson {position}",
                        "content": f"Private lesson {position}.",
                        "video_url": None,
                    },
                )
            if published:
                post(f"courses/{result['id']}/publish")
            return {key: result[key] for key in ("id", "slug", "title")}

        # Keep primary course on the first instructor page after authoring tests.
        for number in range(1, 12):
            course(number, published=True)
        draft = course(13, published=False)
        primary = course(12, published=True, primary=True)
    return {
        **accounts,
        "course": primary,
        "draft": draft,
        "catalog": {"category": category, "search": search, "total": 12},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        if not args.output.is_absolute() or args.output.resolve().is_relative_to(
            Path(__file__).resolve().parents[2]
        ):
            raise ValueError("The private output path must be absolute and outside the repository")
        # Validate effective settings before even reserving the output path.
        guard_configuration()
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            os.fchmod(output.fileno(), 0o600)
            fixture = prepare()
            json.dump(fixture, output)
            output.write("\n")
    except Exception:
        print(
            "Fixture preparation refused or failed. Existing records were not reset; "
            "a reserved output file may be empty. No credentials are printed.",
            file=sys.stderr,
        )
        return 1
    print("Prepared 3 accounts, 12 published courses, 1 draft, 13 modules, 14 lessons.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
