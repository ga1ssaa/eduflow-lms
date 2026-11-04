from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.auth.models import User
from app.courses.models import Course
from app.db.session import get_session_factory

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("resource", ["course", "progress", "lesson"])
def test_protected_read_snapshot_prevents_interleaved_unpublish(
    learning, enrolled_course, learning_actors, resource
):
    from app.learning import service

    course, _, lessons, _ = enrolled_course
    course_id = UUID(course["id"])
    with get_session_factory()() as reader:
        student = reader.get(User, UUID(learning_actors["student"]["id"]))
        if resource == "course":
            snapshot = service.get_course(reader, student, course_id)
            assert snapshot.course_id == course_id
        elif resource == "progress":
            snapshot = service.get_progress(reader, student, course_id)
            assert snapshot.course_id == course_id
        else:
            snapshot = service.get_lesson(reader, student, UUID(lessons[0]["id"]))
            assert snapshot.content == lessons[0]["content"]
        with get_session_factory()() as writer:
            with pytest.raises(OperationalError) as blocked:
                writer.execute(
                    select(Course.id).where(Course.id == course_id).with_for_update(nowait=True)
                )
            assert blocked.value.orig.sqlstate == "55P03"
    # Closing the snapshot releases the lock and the normal publication change succeeds.
    assert learning.author("POST", f"courses/{course['id']}/unpublish").status_code == 200
    assert learning.request("GET", f"students/me/lessons/{lessons[0]['id']}").status_code == 404
