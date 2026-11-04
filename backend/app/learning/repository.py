from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth.models import User
from app.courses.models import Course, Lesson, Module
from app.learning.models import Enrollment, LessonProgress


def enrollment_for_student(db: Session, student_id: UUID, course_id: UUID) -> Enrollment | None:
    return db.scalar(
        select(Enrollment).where(
            Enrollment.student_id == student_id, Enrollment.course_id == course_id
        )
    )


def enroll(db: Session, student_id: UUID, course_id: UUID) -> Enrollment:
    enrollment = db.scalar(
        insert(Enrollment)
        .values(student_id=student_id, course_id=course_id)
        .on_conflict_do_nothing(constraint="uq_enrollments_student_course")
        .returning(Enrollment)
    )
    if enrollment is None:
        enrollment = enrollment_for_student(db, student_id, course_id)
    assert enrollment is not None
    return enrollment


def set_completed(
    db: Session, enrollment_id: UUID, lesson_id: UUID, *, completed: bool
) -> LessonProgress | None:
    if not completed:
        db.execute(
            delete(LessonProgress).where(
                LessonProgress.enrollment_id == enrollment_id, LessonProgress.lesson_id == lesson_id
            )
        )
        return None
    progress = db.scalar(
        insert(LessonProgress)
        .values(enrollment_id=enrollment_id, lesson_id=lesson_id)
        .on_conflict_do_nothing(constraint="uq_lesson_progress_enrollment_lesson")
        .returning(LessonProgress)
    )
    if progress is None:
        progress = db.scalar(
            select(LessonProgress).where(
                LessonProgress.enrollment_id == enrollment_id, LessonProgress.lesson_id == lesson_id
            )
        )
    return progress


def _counts():
    lessons = (
        select(Module.course_id, func.count(Lesson.id).label("total_lessons"))
        .join(Lesson, Lesson.module_id == Module.id)
        .group_by(Module.course_id)
        .subquery()
    )
    completed = (
        select(
            LessonProgress.enrollment_id,
            func.count(LessonProgress.id).label("completed_lessons"),
        )
        .join(Enrollment, Enrollment.id == LessonProgress.enrollment_id)
        .join(Lesson, Lesson.id == LessonProgress.lesson_id)
        .join(Module, Module.id == Lesson.module_id)
        .where(Module.course_id == Enrollment.course_id)
        .group_by(LessonProgress.enrollment_id)
        .subquery()
    )
    return lessons, completed


def _summary_statement():
    lessons, completed = _counts()
    return (
        select(
            Course.id.label("course_id"),
            Enrollment.id.label("enrollment_id"),
            Enrollment.enrolled_at,
            Course.title,
            Course.slug,
            Course.description,
            Course.category,
            Course.level,
            Course.status,
            User.full_name.label("instructor_name"),
            func.coalesce(lessons.c.total_lessons, 0).label("total_lessons"),
            func.coalesce(completed.c.completed_lessons, 0).label("completed_lessons"),
        )
        .select_from(Enrollment)
        .join(Course, Course.id == Enrollment.course_id)
        .join(User, User.id == Course.instructor_id)
        .outerjoin(lessons, lessons.c.course_id == Course.id)
        .outerjoin(completed, completed.c.enrollment_id == Enrollment.id)
    )


def student_courses(
    db: Session, student_id: UUID, *, page: int | None = None, page_size: int = 20
) -> list[dict]:
    statement = (
        _summary_statement()
        .where(Enrollment.student_id == student_id)
        .order_by(Enrollment.enrolled_at.desc(), Enrollment.id.asc())
    )
    if page is not None:
        statement = statement.offset((page - 1) * page_size).limit(page_size)
    return [dict(row) for row in db.execute(statement).mappings()]


def student_course_count(db: Session, student_id: UUID) -> int:
    return (
        db.scalar(select(func.count(Enrollment.id)).where(Enrollment.student_id == student_id)) or 0
    )


def enrollment_summary(db: Session, enrollment_id: UUID) -> dict:
    return dict(
        db.execute(_summary_statement().where(Enrollment.id == enrollment_id)).mappings().one()
    )


def course_progress(db: Session, enrollment_id: UUID) -> dict:
    lessons, completed = _counts()
    return dict(
        db.execute(
            select(
                Enrollment.course_id,
                func.coalesce(lessons.c.total_lessons, 0).label("total_lessons"),
                func.coalesce(completed.c.completed_lessons, 0).label("completed_lessons"),
            )
            .outerjoin(lessons, lessons.c.course_id == Enrollment.course_id)
            .outerjoin(completed, completed.c.enrollment_id == Enrollment.id)
            .where(Enrollment.id == enrollment_id)
        )
        .mappings()
        .one()
    )


def lesson_detail(
    db: Session, lesson_id: UUID, enrollment_id: UUID, course_id: UUID
) -> dict | None:
    row = (
        db.execute(
            select(
                Lesson.id,
                Lesson.title,
                Lesson.content,
                Lesson.video_url,
                Lesson.position,
                Lesson.module_id,
                Module.title.label("module_title"),
                Course.id.label("course_id"),
                Course.title.label("course_title"),
                LessonProgress.completed_at,
            )
            .join(Module, Module.id == Lesson.module_id)
            .join(Course, Course.id == Module.course_id)
            .outerjoin(
                LessonProgress,
                (LessonProgress.lesson_id == Lesson.id)
                & (LessonProgress.enrollment_id == enrollment_id),
            )
            .where(Lesson.id == lesson_id, Course.id == course_id)
        )
        .mappings()
        .one_or_none()
    )
    return dict(row) if row is not None else None


def instructor_students(
    db: Session, course_id: UUID, *, page: int | None = None, page_size: int = 20
) -> list[dict]:
    lessons, completed = _counts()
    statement = (
        select(
            Enrollment.student_id,
            User.full_name,
            Enrollment.id.label("enrollment_id"),
            Enrollment.enrolled_at,
            func.coalesce(lessons.c.total_lessons, 0).label("total_lessons"),
            func.coalesce(completed.c.completed_lessons, 0).label("completed_lessons"),
        )
        .join(User, User.id == Enrollment.student_id)
        .outerjoin(lessons, lessons.c.course_id == Enrollment.course_id)
        .outerjoin(completed, completed.c.enrollment_id == Enrollment.id)
        .where(Enrollment.course_id == course_id)
        .order_by(Enrollment.enrolled_at.desc(), Enrollment.id.asc())
    )
    if page is not None:
        statement = statement.offset((page - 1) * page_size).limit(page_size)
    return [dict(row) for row in db.execute(statement).mappings()]


def course_student_count(db: Session, course_id: UUID) -> int:
    return (
        db.scalar(select(func.count(Enrollment.id)).where(Enrollment.course_id == course_id)) or 0
    )


def lesson_count(db: Session, course_id: UUID) -> int:
    return (
        db.scalar(select(func.count(Lesson.id)).join(Module).where(Module.course_id == course_id))
        or 0
    )


def course_has_enrollments(db: Session, course_id: UUID) -> bool:
    return (
        db.scalar(select(Enrollment.id).where(Enrollment.course_id == course_id).limit(1))
        is not None
    )


def module_has_progress(db: Session, module_id: UUID) -> bool:
    return (
        db.scalar(
            select(LessonProgress.id)
            .join(Lesson, Lesson.id == LessonProgress.lesson_id)
            .where(Lesson.module_id == module_id)
            .limit(1)
        )
        is not None
    )


def lesson_has_progress(db: Session, lesson_id: UUID) -> bool:
    return (
        db.scalar(select(LessonProgress.id).where(LessonProgress.lesson_id == lesson_id).limit(1))
        is not None
    )
