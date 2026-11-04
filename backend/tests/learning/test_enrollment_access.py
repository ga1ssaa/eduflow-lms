from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.auth.models import User
from app.db.session import get_session_factory

pytestmark = pytest.mark.integration


def assert_no_secrets(value):
    if isinstance(value, dict):
        assert not {"password_hash", "token_hash", "email", "access_token"} & value.keys()
        for child in value.values():
            assert_no_secrets(child)
    elif isinstance(value, list):
        for child in value:
            assert_no_secrets(child)


def test_enrollment_is_owned_idempotent_and_timestamp_preserving(learning, learning_actors):
    from app.learning.models import Enrollment

    course, _, _ = learning.course()
    first = learning.enroll(course["id"])
    repeated = learning.enroll(course["id"], json={})
    assert first == repeated
    assert set(first) == {"id", "student_id", "course_id", "enrolled_at"}
    assert first["student_id"] == learning_actors["student"]["id"]
    assert first["course_id"] == course["id"]
    assert first["enrolled_at"]
    other = learning.enroll(course["id"], actor="student2")
    assert other["id"] != first["id"]
    with get_session_factory()() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(Enrollment)
                .where(Enrollment.course_id == UUID(course["id"]))
            )
            == 2
        )


def test_concurrent_enrollment_has_one_row_and_same_response(
    learning, learning_client, learning_actors
):
    from app.learning.models import Enrollment

    course, _, _ = learning.course()
    barrier = Barrier(2)

    def enroll(_):
        with TestClient(learning_client.app) as client:
            barrier.wait(timeout=10)
            response = client.post(
                f"/api/v1/courses/{course['id']}/enroll",
                headers=learning_actors["student"]["headers"],
            )
            assert response.status_code == 200, response.text
            return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(enroll, range(2)))
    assert responses[0] == responses[1]
    with get_session_factory()() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(Enrollment)
                .where(Enrollment.course_id == UUID(course["id"]))
            )
            == 1
        )


@pytest.mark.parametrize("field", ["student_id", "course_id", "enrolled_at", "role"])
def test_enrollment_rejects_identity_or_state_injection(learning, learning_actors, field):
    course, _, _ = learning.course()
    response = learning.request(
        "POST", f"courses/{course['id']}/enroll", json={field: learning_actors["student2"]["id"]}
    )
    assert response.status_code == 422, response.text
    assert learning.request("GET", "students/me/courses").json()["total"] == 0


@pytest.mark.parametrize(
    "actor,expected", [(None, 401), ("inactive", 401), ("owner", 403), ("admin", 403)]
)
def test_all_student_routes_require_current_active_student(learning, actor, expected):
    course, _, lessons = learning.course()
    course_id, lesson_id = course["id"], lessons[0]["id"]
    for method, path in [
        ("POST", f"courses/{course_id}/enroll"),
        ("GET", "students/me/courses"),
        ("GET", f"students/me/courses/{course_id}"),
        ("GET", f"students/me/courses/{course_id}/progress"),
        ("GET", f"students/me/lessons/{lesson_id}"),
        ("POST", f"students/me/lessons/{lesson_id}/complete"),
        ("DELETE", f"students/me/lessons/{lesson_id}/complete"),
        ("GET", "students/me/dashboard"),
    ]:
        response = learning.request(method, path, actor=actor)
        assert response.status_code == expected, (path, response.text)


def test_current_database_active_state_overrides_previously_valid_token(learning, learning_actors):
    assert learning.request("GET", "students/me/dashboard").status_code == 200
    with get_session_factory()() as db:
        db.execute(
            update(User)
            .where(User.id == UUID(learning_actors["student"]["id"]))
            .values(is_active=False)
        )
        db.commit()
    assert learning.request("GET", "students/me/dashboard").status_code == 401


def test_enrollment_requires_existing_published_course(learning):
    draft, _, _ = learning.course(published=False)
    for course_id in [draft["id"], str(uuid4())]:
        response = learning.request("POST", f"courses/{course_id}/enroll")
        assert response.status_code == 404
    assert learning.request("GET", "students/me/courses").json()["total"] == 0


def test_protected_content_enforces_enrollment_publication_and_student_isolation(
    learning, enrolled_course
):
    course, _, lessons, _ = enrolled_course
    lesson = lessons[0]
    paths = [
        ("GET", f"students/me/courses/{course['id']}"),
        ("GET", f"students/me/courses/{course['id']}/progress"),
        ("GET", f"students/me/lessons/{lesson['id']}"),
        ("POST", f"students/me/lessons/{lesson['id']}/complete"),
        ("DELETE", f"students/me/lessons/{lesson['id']}/complete"),
    ]
    for method, path in paths:
        response = learning.request(method, path, actor="student2")
        assert response.status_code == 404, (path, response.text)
        assert lesson["content"] not in response.text
    content = learning.request("GET", f"students/me/lessons/{lesson['id']}")
    assert content.status_code == 200
    assert content.json()["content"] == lesson["content"]
    assert content.json()["video_url"] == lesson["video_url"]
    assert content.json()["course_id"] == course["id"]
    assert content.json()["is_completed"] is False
    assert content.json()["completed_at"] is None
    assert learning.author("POST", f"courses/{course['id']}/unpublish").status_code == 200
    for method, path in paths:
        response = learning.request(method, path)
        assert response.status_code == 404, (path, response.text)
        assert lesson["content"] not in response.text
    assert learning.request("POST", f"courses/{course['id']}/enroll").status_code == 404
    assert learning.author("POST", f"courses/{course['id']}/publish").status_code == 200
    assert learning.request("GET", f"students/me/lessons/{lesson['id']}").status_code == 200


def test_course_detail_has_ordered_outline_without_other_lessons_content(learning, enrolled_course):
    course, module, lessons, enrollment = enrolled_course
    response = learning.request("GET", f"students/me/courses/{course['id']}")
    assert response.status_code == 200
    detail = response.json()
    assert detail["course_id"] == course["id"]
    assert detail["enrollment_id"] == enrollment["id"]
    assert detail["modules"][0]["id"] == module["id"]
    assert [item["id"] for item in detail["modules"][0]["lessons"]] == [
        item["id"] for item in lessons
    ]
    assert detail["progress"]["total_lessons"] == 3
    for item in lessons:
        assert item["content"] not in response.text
    assert_no_secrets(detail)


@pytest.mark.parametrize("kind", ["courses", "lessons"])
def test_missing_and_malformed_resource_ids(learning, kind):
    for resource_id, expected in [(str(uuid4()), 404), ("not-a-uuid", 422)]:
        response = learning.request("GET", f"students/me/{kind}/{resource_id}")
        assert response.status_code == expected


@pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 0}, {"page_size": 101}])
def test_student_courses_reject_invalid_pagination(learning, params):
    assert learning.request("GET", "students/me/courses", params=params).status_code == 422
