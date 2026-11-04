from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import inspect, select, text, update
from sqlalchemy.exc import IntegrityError

from app.courses.models import Lesson, Module
from app.db.session import get_engine, get_session_factory

pytestmark = pytest.mark.integration


def test_database_rejects_duplicate_enrollment_completion_and_missing_parents(
    learning, enrolled_course, learning_actors
):
    from app.learning.models import Enrollment, LessonProgress

    course, _, lessons, enrollment = enrolled_course
    learning.complete(lessons[0]["id"])
    course_id, enrollment_id = UUID(course["id"]), UUID(enrollment["id"])
    student_id = UUID(learning_actors["student"]["id"])
    invalid_records = [
        Enrollment(student_id=student_id, course_id=course_id),
        Enrollment(student_id=uuid4(), course_id=course_id),
        Enrollment(student_id=student_id, course_id=uuid4()),
        LessonProgress(enrollment_id=enrollment_id, lesson_id=UUID(lessons[0]["id"])),
        LessonProgress(enrollment_id=uuid4(), lesson_id=UUID(lessons[1]["id"])),
        LessonProgress(enrollment_id=enrollment_id, lesson_id=uuid4()),
    ]
    with get_session_factory()() as db:
        for record in invalid_records:
            with pytest.raises(IntegrityError), db.begin_nested():
                db.add(record)
                db.flush()
            assert (
                db.scalar(select(Enrollment.id).where(Enrollment.id == enrollment_id))
                == enrollment_id
            )
        # A valid write still works following every rejected statement; close rolls it back.
        db.add(LessonProgress(enrollment_id=enrollment_id, lesson_id=UUID(lessons[1]["id"])))
        db.flush()


def test_database_cross_course_progress_insert_and_update_are_rejected(learning, enrolled_course):
    from app.learning.models import Enrollment, LessonProgress

    _, _, lessons, enrollment = enrolled_course
    foreign_course, _, foreign_lessons = learning.course()
    foreign_enrollment = learning.enroll(foreign_course["id"])
    learning.complete(lessons[0]["id"])
    enrollment_id = UUID(enrollment["id"])
    with get_session_factory()() as db:
        statements = [
            lambda: db.add(
                LessonProgress(
                    enrollment_id=enrollment_id, lesson_id=UUID(foreign_lessons[0]["id"])
                )
            ),
            lambda: db.execute(
                update(LessonProgress)
                .where(LessonProgress.enrollment_id == enrollment_id)
                .values(lesson_id=UUID(foreign_lessons[0]["id"]))
            ),
            lambda: db.execute(
                update(LessonProgress)
                .where(LessonProgress.enrollment_id == enrollment_id)
                .values(enrollment_id=UUID(foreign_enrollment["id"]))
            ),
        ]
        for statement in statements:
            with pytest.raises(IntegrityError) as rejected, db.begin_nested():
                statement()
                db.flush()
            assert rejected.value.orig.sqlstate == "23514"
            assert (
                db.scalar(select(Enrollment.id).where(Enrollment.id == enrollment_id))
                == enrollment_id
            )
        progress = db.scalar(
            select(LessonProgress).where(LessonProgress.enrollment_id == enrollment_id)
        )
        assert str(progress.lesson_id) == lessons[0]["id"]


def test_database_parent_identifiers_are_immutable(learning, enrolled_course, learning_actors):
    from app.learning.models import Enrollment

    course, module, lessons, enrollment = enrolled_course
    foreign, foreign_module, _ = learning.course()
    statements = [
        update(Module).where(Module.id == UUID(module["id"])).values(course_id=UUID(foreign["id"])),
        update(Lesson)
        .where(Lesson.id == UUID(lessons[0]["id"]))
        .values(module_id=UUID(foreign_module["id"])),
        update(Enrollment)
        .where(Enrollment.id == UUID(enrollment["id"]))
        .values(course_id=UUID(foreign["id"])),
        update(Enrollment)
        .where(Enrollment.id == UUID(enrollment["id"]))
        .values(student_id=UUID(learning_actors["student2"]["id"])),
    ]
    with get_session_factory()() as db:
        for statement in statements:
            with pytest.raises(IntegrityError) as rejected, db.begin_nested():
                db.execute(statement)
            assert rejected.value.orig.sqlstate == "23514"
            assert db.scalar(
                select(Enrollment.course_id).where(Enrollment.id == UUID(enrollment["id"]))
            ) == UUID(course["id"])
        assert db.scalar(select(Module.course_id).where(Module.id == UUID(module["id"]))) == UUID(
            course["id"]
        )
        assert db.scalar(
            select(Lesson.module_id).where(Lesson.id == UUID(lessons[0]["id"]))
        ) == UUID(module["id"])


def test_learning_foreign_keys_are_restrict_and_timestamps_are_timezone_aware(
    learning, enrolled_course
):
    from app.learning.models import Enrollment, LessonProgress

    _, _, lessons, enrollment = enrolled_course
    learning.complete(lessons[0]["id"])
    expected = {
        "enrollments": {("student_id", "users"), ("course_id", "courses")},
        "lesson_progress": {("enrollment_id", "enrollments"), ("lesson_id", "lessons")},
    }
    inspector = inspect(get_engine())
    for table, relationships in expected.items():
        foreign_keys = inspector.get_foreign_keys(table)
        assert {
            (item["constrained_columns"][0], item["referred_table"]) for item in foreign_keys
        } == relationships
        assert all(item["options"].get("ondelete") == "RESTRICT" for item in foreign_keys)
    with get_session_factory()() as db:
        enrolled_at = db.get(Enrollment, UUID(enrollment["id"])).enrolled_at
        completed_at = db.scalar(
            select(LessonProgress.completed_at).where(
                LessonProgress.enrollment_id == UUID(enrollment["id"])
            )
        )
        for timestamp in [enrolled_at, completed_at]:
            assert timestamp.tzinfo is not None
            assert timestamp <= datetime.now(UTC)


@pytest.mark.parametrize("pending_parent", ["enrollment", "lesson"])
def test_invisible_uncommitted_parents_cannot_bypass_course_validation(
    learning, enrolled_course, learning_actors, pending_parent
):
    from app.learning.models import Enrollment, LessonProgress

    course, _, _, enrollment = enrolled_course
    _, foreign_module, foreign_lessons = learning.course()
    with get_session_factory()() as creator:
        if pending_parent == "enrollment":
            parent = Enrollment(
                student_id=UUID(learning_actors["student2"]["id"]),
                course_id=UUID(course["id"]),
            )
            creator.add(parent)
            creator.flush()
            enrollment_id = parent.id
            lesson_id = UUID(foreign_lessons[0]["id"])
        else:
            parent = Lesson(
                module_id=UUID(foreign_module["id"]),
                title="Pending lesson",
                content="Body",
                position=len(foreign_lessons) + 1,
            )
            creator.add(parent)
            creator.flush()
            enrollment_id = UUID(enrollment["id"])
            lesson_id = parent.id
        with get_session_factory()() as contender:
            contender.execute(text("SET LOCAL lock_timeout = '500ms'"))
            with pytest.raises(IntegrityError) as rejected:
                contender.add(LessonProgress(enrollment_id=enrollment_id, lesson_id=lesson_id))
                contender.flush()
            assert rejected.value.orig.sqlstate == "23503"
