from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.session import get_session_factory

pytestmark = pytest.mark.integration


def test_database_foreign_keys_unique_positions_and_checks_recover_after_failure(author):
    from app.courses.models import Course, Lesson, Module

    course, module, lesson = author.ready()
    course_id, module_id = UUID(course["id"]), UUID(module["id"])
    with get_session_factory()() as db:
        invalid_records = [
            Module(course_id=course_id, title="Duplicate", position=module["position"]),
            Module(course_id=course_id, title="Negative", position=-1),
            Module(course_id=uuid4(), title="Missing course", position=1),
            Lesson(module_id=module_id, title="Duplicate", position=lesson["position"]),
            Lesson(module_id=module_id, title="Zero", position=0),
            Lesson(module_id=uuid4(), title="Missing module", position=1),
        ]
        for record in invalid_records:
            with pytest.raises(IntegrityError), db.begin_nested():
                db.add(record)
                db.flush()
            assert db.scalar(select(Course.id).where(Course.id == course_id)) == course_id
        for field, value in [("level", "invalid"), ("status", "invalid")]:
            with pytest.raises(IntegrityError), db.begin_nested():
                setattr(db.get(Course, course_id), field, value)
                db.flush()
        valid = Module(course_id=course_id, title="Valid after failures", position=2)
        db.add(valid)
        db.flush()
        assert valid.id is not None
        # This transaction only proves recovery and is rolled back on close.


def test_draft_delete_cascades_module_and_lesson_rows(author):
    from app.courses.models import Course, Lesson, Module

    course, module, lesson = author.ready()
    assert author.request("DELETE", f"courses/{course['id']}").status_code == 204
    with get_session_factory()() as db:
        assert db.get(Course, UUID(course["id"])) is None
        assert db.get(Module, UUID(module["id"])) is None
        assert db.get(Lesson, UUID(lesson["id"])) is None
