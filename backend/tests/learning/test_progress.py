from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.session import get_session_factory

pytestmark = pytest.mark.integration


def assert_progress(progress, course_id, total, completed, percentage, finished=False):
    assert progress == {
        "course_id": course_id,
        "total_lessons": total,
        "completed_lessons": completed,
        "progress_percentage": percentage,
        "is_completed": finished,
    }


def test_progress_rounding_completion_repetition_and_incomplete(learning, enrolled_course):
    course, _, lessons, _ = enrolled_course
    course_id = course["id"]
    assert_progress(learning.progress(course_id), course_id, 3, 0, 0)
    for index, percentage in enumerate([33.33, 66.67, 100]):
        result = learning.complete(lessons[index]["id"])
        assert result["lesson_id"] == lessons[index]["id"]
        assert result["is_completed"] is True
        assert result["completed_at"]
        assert_progress(result["progress"], course_id, 3, index + 1, percentage, index == 2)
        assert learning.complete(lessons[index]["id"], json={}) == result
        detail = learning.request("GET", f"students/me/lessons/{lessons[index]['id']}").json()
        assert detail["is_completed"] is True
        assert detail["completed_at"] == result["completed_at"]
    assert_progress(learning.progress(course_id), course_id, 3, 3, 100, True)
    result = learning.complete(lessons[1]["id"], method="DELETE")
    assert result["is_completed"] is False and result["completed_at"] is None
    assert_progress(result["progress"], course_id, 3, 2, 66.67)
    assert learning.complete(lessons[1]["id"], method="DELETE") == result
    detail = learning.request("GET", f"students/me/lessons/{lessons[1]['id']}").json()
    assert detail["is_completed"] is False and detail["completed_at"] is None


@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_concurrent_completion_and_incomplete_are_idempotent(
    learning, enrolled_course, learning_client, learning_actors, method
):
    from app.learning.models import LessonProgress

    course, _, lessons, enrollment = enrolled_course
    lesson_id = lessons[0]["id"]
    if method == "DELETE":
        learning.complete(lesson_id)
    barrier = Barrier(2)

    def change(_):
        with TestClient(learning_client.app) as client:
            barrier.wait(timeout=10)
            response = client.request(
                method,
                f"/api/v1/students/me/lessons/{lesson_id}/complete",
                headers=learning_actors["student"]["headers"],
            )
            assert response.status_code == 200, response.text
            return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(change, range(2)))
    assert responses[0] == responses[1]
    complete = method == "POST"
    assert responses[0]["is_completed"] is complete
    assert_progress(
        responses[0]["progress"], course["id"], 3, int(complete), 33.33 if complete else 0
    )
    with get_session_factory()() as db:
        count = db.scalar(
            select(func.count())
            .select_from(LessonProgress)
            .where(
                LessonProgress.enrollment_id == UUID(enrollment["id"]),
                LessonProgress.lesson_id == UUID(lesson_id),
            )
        )
        assert count == int(complete)


@pytest.mark.parametrize(
    "field", ["student_id", "enrollment_id", "lesson_id", "completed_at", "is_completed"]
)
def test_completion_rejects_identity_or_state_injection(learning, enrolled_course, field):
    course, _, lessons, _ = enrolled_course
    response = learning.request(
        "POST", f"students/me/lessons/{lessons[0]['id']}/complete", json={field: "injected"}
    )
    assert response.status_code == 422, response.text
    assert_progress(learning.progress(course["id"]), course["id"], 3, 0, 0)


def test_progress_is_student_specific_and_tracks_actual_curriculum(learning, enrolled_course):
    course, module, lessons, _ = enrolled_course
    learning.enroll(course["id"], actor="student2")
    for lesson in lessons:
        learning.complete(lesson["id"])
    assert_progress(learning.progress(course["id"], actor="student2"), course["id"], 3, 0, 0)
    assert_progress(learning.progress(course["id"]), course["id"], 3, 3, 100, True)
    appended = learning.lesson(module["id"], index=4)
    assert_progress(learning.progress(course["id"]), course["id"], 4, 3, 75)
    response = learning.author("DELETE", f"lessons/{appended['id']}")
    assert response.status_code == 204, response.text
    assert_progress(learning.progress(course["id"]), course["id"], 3, 3, 100, True)


def test_deleting_completed_lesson_or_module_is_atomic_conflict(learning, enrolled_course):
    course, module, lessons, _ = enrolled_course
    completion = learning.complete(lessons[0]["id"])
    for path in [f"lessons/{lessons[0]['id']}", f"modules/{module['id']}"]:
        response = learning.author("DELETE", path)
        assert response.status_code == 409, response.text
        detail = learning.author("GET", f"courses/{course['id']}")
        assert detail.status_code == 200
        assert [item["id"] for item in detail.json()["modules"][0]["lessons"]] == [
            lesson["id"] for lesson in lessons
        ]
        assert learning.complete(lessons[0]["id"]) == completion
    # The guard is driven by persisted completion, so clearing it permits deletion.
    learning.complete(lessons[0]["id"], method="DELETE")
    assert learning.author("DELETE", f"lessons/{lessons[0]['id']}").status_code == 204
    assert_progress(learning.progress(course["id"]), course["id"], 2, 0, 0)


def test_enrolled_course_deletion_is_blocked_even_after_unpublishing(learning, enrolled_course):
    course, _, lessons, enrollment = enrolled_course
    assert learning.author("POST", f"courses/{course['id']}/unpublish").status_code == 200
    response = learning.author("DELETE", f"courses/{course['id']}")
    assert response.status_code == 409, response.text
    persisted = learning.author("GET", f"courses/{course['id']}")
    assert persisted.status_code == 200
    assert len(persisted.json()["modules"][0]["lessons"]) == len(lessons)
    assert learning.author("POST", f"courses/{course['id']}/publish").status_code == 200
    assert learning.enroll(course["id"]) == enrollment
