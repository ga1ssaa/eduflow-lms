import pytest
from sqlalchemy import event

from app.db.session import get_engine

pytestmark = pytest.mark.integration


def assert_metadata_only(value):
    if isinstance(value, dict):
        assert (
            not {
                "content",
                "video_url",
                "modules",
                "lessons",
                "password_hash",
                "token_hash",
                "email",
            }
            & value.keys()
        )
        for child in value.values():
            assert_metadata_only(child)
    elif isinstance(value, list):
        for child in value:
            assert_metadata_only(child)


def test_empty_dashboard_list_and_unenrolled_instructor_stats(learning):
    assert learning.request("GET", "students/me/dashboard").json() == {
        "total_enrolled_courses": 0,
        "completed_courses": 0,
        "in_progress_courses": 0,
        "courses": [],
    }
    assert learning.request("GET", "students/me/courses").json() == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 20,
    }
    course, _, _ = learning.course()
    response = learning.author("GET", f"courses/{course['id']}/stats")
    assert response.status_code == 200
    assert response.json() == {
        "course_id": course["id"],
        "total_students": 0,
        "completed_students": 0,
        "in_progress_students": 0,
        "average_progress_percentage": 0,
        "total_lessons": 3,
    }
    page = learning.author("GET", f"courses/{course['id']}/students")
    assert page.status_code == 200
    assert page.json() == {"items": [], "total": 0, "page": 1, "page_size": 20}


def test_dashboard_and_paginated_courses_include_unpublished_metadata_and_zero_denominator(
    learning,
):
    finished, _, finished_lessons = learning.course(lesson_count=1)
    active, active_module, active_lessons = learning.course()
    empty, _, empty_lessons = learning.course(lesson_count=1)
    enrollments = {item["id"]: learning.enroll(item["id"]) for item in [finished, active, empty]}
    learning.complete(finished_lessons[0]["id"])
    learning.complete(active_lessons[0]["id"])
    # An empty module is valid and must not alter lesson-based progress.
    assert (
        learning.author(
            "POST", f"courses/{active['id']}/modules", json={"title": "Empty module"}
        ).status_code
        == 201
    )
    assert learning.progress(active["id"])["progress_percentage"] == 33.33
    assert active_module["id"]
    assert learning.author("POST", f"courses/{empty['id']}/unpublish").status_code == 200
    assert learning.author("DELETE", f"lessons/{empty_lessons[0]['id']}").status_code == 204
    response = learning.request("GET", "students/me/dashboard")
    assert response.status_code == 200
    dashboard = response.json()
    assert dashboard["total_enrolled_courses"] == 3
    assert dashboard["completed_courses"] == 1
    assert dashboard["in_progress_courses"] == 2
    summaries = {item["course_id"]: item for item in dashboard["courses"]}
    assert summaries.keys() == enrollments.keys()
    for course_id, summary in summaries.items():
        assert summary["enrollment_id"] == enrollments[course_id]["id"]
        assert summary["enrolled_at"] == enrollments[course_id]["enrolled_at"]
    assert summaries[finished["id"]]["is_completed"] is True
    assert summaries[active["id"]]["progress_percentage"] == 33.33
    unavailable = summaries[empty["id"]]
    assert unavailable["status"] == "draft" and unavailable["is_available"] is False
    assert unavailable["total_lessons"] == 0 and unavailable["completed_lessons"] == 0
    assert unavailable["progress_percentage"] == 0 and unavailable["is_completed"] is False
    assert_metadata_only(dashboard)
    seen = []
    for page in range(1, 4):
        response = learning.request(
            "GET", "students/me/courses", params={"page": page, "page_size": 1}
        )
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 3 and result["page"] == page and result["page_size"] == 1
        assert len(result["items"]) == 1
        seen.append(result["items"][0]["course_id"])
        assert_metadata_only(result)
    assert len(set(seen)) == 3 and set(seen) == set(enrollments)
    assert (
        learning.request("GET", "students/me/courses", params={"page": 4, "page_size": 1}).json()[
            "items"
        ]
        == []
    )
    assert (
        learning.request("GET", "students/me/dashboard", actor="student2").json()["courses"] == []
    )


def test_instructor_owned_roster_and_stats_reflect_real_progress(
    learning, enrolled_course, learning_actors
):
    course, _, lessons, enrollment = enrolled_course
    second = learning.enroll(course["id"], actor="student2")
    learning.complete(lessons[0]["id"])
    response = learning.author("GET", f"courses/{course['id']}/stats")
    assert response.status_code == 200
    assert response.json() == {
        "course_id": course["id"],
        "total_students": 2,
        "completed_students": 0,
        "in_progress_students": 2,
        "average_progress_percentage": 16.67,
        "total_lessons": 3,
    }
    rows = []
    for page in [1, 2]:
        response = learning.author(
            "GET", f"courses/{course['id']}/students", params={"page": page, "page_size": 1}
        )
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 2 and result["page"] == page and result["page_size"] == 1
        rows.extend(result["items"])
        assert_metadata_only(result)
    by_student = {row["student_id"]: row for row in rows}
    assert len(by_student) == 2
    for actor, record, completed, percentage in [
        ("student", enrollment, 1, 33.33),
        ("student2", second, 0, 0),
    ]:
        row = by_student[learning_actors[actor]["id"]]
        assert row["full_name"] == learning_actors[actor]["name"]
        assert row["enrollment_id"] == record["id"]
        assert row["enrolled_at"] == record["enrolled_at"]
        assert row["completed_lessons"] == completed and row["total_lessons"] == 3
        assert row["progress_percentage"] == percentage and row["is_completed"] is False
    for lesson in lessons[1:]:
        learning.complete(lesson["id"])
    result = learning.author("GET", f"courses/{course['id']}/stats").json()
    assert result["completed_students"] == 1 and result["in_progress_students"] == 1
    assert result["average_progress_percentage"] == 50
    # Instructors retain statistics access after publication is withdrawn.
    assert learning.author("POST", f"courses/{course['id']}/unpublish").status_code == 200
    assert learning.author("GET", f"courses/{course['id']}/stats").json() == result


@pytest.mark.parametrize("suffix", ["students", "stats"])
def test_instructor_data_requires_owner_or_explicit_admin(learning, enrolled_course, suffix):
    course, _, _, _ = enrolled_course
    path = f"instructor/courses/{course['id']}/{suffix}"
    for actor, expected in [
        (None, 401),
        ("inactive", 401),
        ("student", 403),
        ("student2", 403),
        ("other", 403),
        ("owner", 200),
        ("admin", 200),
    ]:
        response = learning.request("GET", path, actor=actor)
        assert response.status_code == expected, (actor, suffix, response.text)
    from uuid import uuid4

    assert (
        learning.request("GET", f"instructor/courses/{uuid4()}/{suffix}", actor="owner").status_code
        == 404
    )


@pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 0}, {"page_size": 101}])
def test_instructor_students_validate_pagination(learning, enrolled_course, params):
    course, _, _, _ = enrolled_course
    response = learning.author("GET", f"courses/{course['id']}/students", params=params)
    assert response.status_code == 422


def test_dashboard_and_instructor_queries_are_bounded(learning):
    courses = [learning.course()[0] for _ in range(3)]
    for course in courses:
        learning.enroll(course["id"])
    course_id = courses[0]["id"]
    learning.enroll(course_id, actor="student2")
    for path, actor, maximum in [
        ("students/me/dashboard", "student", 3),
        ("students/me/courses", "student", 3),
        (f"instructor/courses/{course_id}/students", "owner", 4),
        (f"instructor/courses/{course_id}/stats", "owner", 4),
    ]:
        queries = []

        def collect(
            connection, cursor, statement, parameters, context, executemany, collected=queries
        ):
            if statement.lstrip().upper().startswith("SELECT"):
                collected.append(statement)

        engine = get_engine()
        event.listen(engine, "before_cursor_execute", collect)
        try:
            response = learning.request("GET", path, actor=actor)
        finally:
            event.remove(engine, "before_cursor_execute", collect)
        assert response.status_code == 200
        assert len(queries) <= maximum, (path, len(queries))
