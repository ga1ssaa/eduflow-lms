import os
import secrets
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.auth.models import User
from app.auth.security import create_access_token, hash_password
from app.core.config import get_settings
from app.db.session import get_engine, get_session_factory
from app.main import create_app
from testutils.database import guard_test_database_url


def clear_course_caches():
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def migrated_course_database():
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Set TEST_DATABASE_URL to an isolated eduflow_test_ PostgreSQL database")
    try:
        guard_test_database_url(database_url)
    except ValueError as error:
        pytest.fail(str(error), pytrace=False)
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("DATABASE_URL", database_url)
        patch.setenv("JWT_SECRET", secrets.token_urlsafe(48))
        clear_course_caches()
        backend = Path(__file__).resolve().parents[2]
        config = Config(str(backend / "alembic.ini"))
        config.set_main_option("script_location", str(backend / "alembic"))
        command.upgrade(config, "head")
        clear_course_caches()
    return database_url


@pytest.fixture
def course_client(migrated_course_database, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", migrated_course_database)
    monkeypatch.setenv("AUTH_ALLOWED_ORIGINS", '["http://localhost:5173"]')
    clear_course_caches()
    try:
        with TestClient(create_app()) as client:
            yield client
    finally:
        clear_course_caches()


@pytest.fixture
def actors(course_client):
    result = {}
    password_hash = hash_password(secrets.token_urlsafe(32))
    with get_session_factory()() as db:
        for label, role, active in [
            ("owner", "instructor", True),
            ("other", "instructor", True),
            ("student", "student", True),
            ("admin", "admin", True),
            ("inactive", "instructor", False),
        ]:
            user = User(
                email=f"course-{uuid4().hex}@example.com",
                full_name=f"Course {label.title()}",
                password_hash=password_hash,
                role=role,
                is_active=active,
            )
            db.add(user)
            db.flush()
            result[label] = {
                "id": str(user.id),
                "name": user.full_name,
                "headers": {
                    "Authorization": f"Bearer {create_access_token(user.id, get_settings())}"
                },
            }
        db.commit()
    return result


@pytest.fixture
def author(course_client, actors):
    class Author:
        def request(self, method, path, actor="owner", **kwargs):
            return course_client.request(
                method, f"/api/v1/instructor/{path}", headers=actors[actor]["headers"], **kwargs
            )

        def course(self, **overrides):
            payload = {"title": "QA Course", "slug": f"qa-{uuid4().hex}", **overrides}
            response = self.request("POST", "courses", json=payload)
            assert response.status_code == 201, response.text
            return response.json()

        def module(self, course_id, title="QA Module"):
            response = self.request("POST", f"courses/{course_id}/modules", json={"title": title})
            assert response.status_code == 201, response.text
            return response.json()

        def lesson(self, module_id, **overrides):
            response = self.request(
                "POST",
                f"modules/{module_id}/lessons",
                json={"title": "QA Lesson", "content": "Private lesson body", **overrides},
            )
            assert response.status_code == 201, response.text
            return response.json()

        def ready(self, **overrides):
            course = self.course(description="Course description", category="qa", **overrides)
            module = self.module(course["id"])
            lesson = self.lesson(module["id"])
            return course, module, lesson

    return Author()
