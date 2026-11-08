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


def clear_learning_caches():
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def migrated_learning_database():
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
        clear_learning_caches()
        backend = Path(__file__).resolve().parents[2]
        config = Config(str(backend / "alembic.ini"))
        config.set_main_option("script_location", str(backend / "alembic"))
        command.upgrade(config, "head")
        clear_learning_caches()
    return database_url


@pytest.fixture
def learning_client(migrated_learning_database, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", migrated_learning_database)
    clear_learning_caches()
    try:
        with TestClient(create_app()) as client:
            yield client
    finally:
        clear_learning_caches()


@pytest.fixture
def learning_actors(learning_client):
    result = {}
    password_hash = hash_password(secrets.token_urlsafe(32))
    with get_session_factory()() as db:
        for label, role, active in [
            ("owner", "instructor", True),
            ("other", "instructor", True),
            ("student", "student", True),
            ("student2", "student", True),
            ("admin", "admin", True),
            ("inactive", "student", False),
        ]:
            user = User(
                email=f"learning-{uuid4().hex}@example.com",
                full_name=f"Learning {label.title()}",
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
def learning(learning_client, learning_actors):
    class Learning:
        def request(self, method, path, actor="student", **kwargs):
            headers = learning_actors[actor]["headers"] if actor else {}
            return learning_client.request(method, f"/api/v1/{path}", headers=headers, **kwargs)

        def author(self, method, path, **kwargs):
            return self.request(method, f"instructor/{path}", actor="owner", **kwargs)

        def course(self, lesson_count=3, published=True):
            response = self.author(
                "POST",
                "courses",
                json={
                    "title": "Learning fixture course",
                    "slug": f"learning-{uuid4().hex}",
                    "description": "Learning fixture description",
                    "category": "learning-qa",
                },
            )
            assert response.status_code == 201, response.text
            course = response.json()
            response = self.author(
                "POST", f"courses/{course['id']}/modules", json={"title": "Learning module"}
            )
            assert response.status_code == 201, response.text
            module = response.json()
            lessons = [self.lesson(module["id"], index) for index in range(lesson_count)]
            if published:
                response = self.author("POST", f"courses/{course['id']}/publish")
                assert response.status_code == 200, response.text
                course = response.json()
            return course, module, lessons

        def lesson(self, module_id, index=0):
            response = self.author(
                "POST",
                f"modules/{module_id}/lessons",
                json={
                    "title": f"Lesson {index}",
                    "content": f"Private lesson content {index}",
                    "video_url": f"https://example.com/private-video-{index}",
                },
            )
            assert response.status_code == 201, response.text
            return response.json()

        def enroll(self, course_id, actor="student", **kwargs):
            response = self.request("POST", f"courses/{course_id}/enroll", actor=actor, **kwargs)
            assert response.status_code == 200, response.text
            return response.json()

        def complete(self, lesson_id, actor="student", method="POST", **kwargs):
            response = self.request(
                method, f"students/me/lessons/{lesson_id}/complete", actor=actor, **kwargs
            )
            assert response.status_code == 200, response.text
            return response.json()

        def progress(self, course_id, actor="student"):
            response = self.request("GET", f"students/me/courses/{course_id}/progress", actor=actor)
            assert response.status_code == 200, response.text
            return response.json()

    return Learning()


@pytest.fixture
def enrolled_course(learning):
    course, module, lessons = learning.course()
    enrollment = learning.enroll(course["id"])
    return course, module, lessons, enrollment
