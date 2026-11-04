from collections.abc import Iterator
from contextlib import contextmanager
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.courses import repository as course_repository
from app.courses.models import Course
from app.learning import repository
from app.learning.models import Enrollment
from app.learning.schemas import (
    CompletionRead,
    CourseProgress,
    CourseStats,
    EnrolledCoursePage,
    EnrolledCourseSummary,
    EnrollmentRead,
    InstructorStudentPage,
    InstructorStudentRead,
    StudentCourseRead,
    StudentDashboard,
    StudentLessonRead,
)


@contextmanager
def _write(db: Session) -> Iterator[None]:
    try:
        yield
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Learning conflict") from None
    except Exception:
        db.rollback()
        raise


def percentage(completed: int, total: int) -> float:
    if not total:
        return 0.0
    return float(
        (Decimal(completed) * 100 / Decimal(total)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    )


def _progress_values(row: dict) -> dict:
    total, completed = row["total_lessons"], row["completed_lessons"]
    return {
        **row,
        "progress_percentage": percentage(completed, total),
        "is_completed": total > 0 and completed == total,
    }


def _summary(row: dict) -> EnrolledCourseSummary:
    return EnrolledCourseSummary.model_validate(
        {**_progress_values(row), "is_available": row["status"] == "published"}
    )


def _published_course(db: Session, course_id: UUID, *, write: bool = False) -> Course:
    course = course_repository.course_by_id(db, course_id, lock=write, shared_lock=not write)
    if course is None or course.status != "published":
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _enrolled_course(
    db: Session, user: User, course_id: UUID, *, write: bool = False
) -> tuple[Course, Enrollment]:
    course = _published_course(db, course_id, write=write)
    enrollment = repository.enrollment_for_student(db, user.id, course.id)
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course, enrollment


def _lesson_access(
    db: Session, user: User, lesson_id: UUID, *, write: bool = False
) -> tuple[Course, Enrollment, dict]:
    course_id = course_repository.course_id_for_lesson(db, lesson_id)
    if course_id is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    course, enrollment = _enrolled_course(db, user, course_id, write=write)
    lesson = repository.lesson_detail(db, lesson_id, enrollment.id, course.id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return course, enrollment, lesson


def _owned_course(db: Session, user: User, course_id: UUID) -> Course:
    course = course_repository.course_by_id(db, course_id, shared_lock=True)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    if user.role not in {"instructor", "admin"} or (
        user.role != "admin" and course.instructor_id != user.id
    ):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return course


def enroll(db: Session, user: User, course_id: UUID) -> EnrollmentRead:
    with _write(db):
        _published_course(db, course_id, write=True)
        enrollment = repository.enroll(db, user.id, course_id)
        result = EnrollmentRead.model_validate(enrollment)
    return result


def list_courses(db: Session, user: User, *, page: int, page_size: int) -> EnrolledCoursePage:
    rows = repository.student_courses(db, user.id, page=page, page_size=page_size)
    return EnrolledCoursePage(
        items=[_summary(row) for row in rows],
        total=repository.student_course_count(db, user.id),
        page=page,
        page_size=page_size,
    )


def get_course(db: Session, user: User, course_id: UUID) -> StudentCourseRead:
    course, enrollment = _enrolled_course(db, user, course_id)
    summary = _summary(repository.enrollment_summary(db, enrollment.id))
    outline = course_repository.course_detail(db, course.id, public=True)
    return StudentCourseRead.model_validate(
        {
            **summary.model_dump(),
            "modules": outline["modules"],
            "progress": get_progress(db, user, course_id),
        }
    )


def get_lesson(db: Session, user: User, lesson_id: UUID) -> StudentLessonRead:
    _, _, lesson = _lesson_access(db, user, lesson_id)
    return StudentLessonRead.model_validate(
        {**lesson, "is_completed": lesson["completed_at"] is not None}
    )


def set_completion(db: Session, user: User, lesson_id: UUID, *, completed: bool) -> CompletionRead:
    with _write(db):
        _, enrollment, _ = _lesson_access(db, user, lesson_id, write=True)
        completion = repository.set_completed(db, enrollment.id, lesson_id, completed=completed)
        progress = CourseProgress.model_validate(
            _progress_values(repository.course_progress(db, enrollment.id))
        )
        result = CompletionRead(
            lesson_id=lesson_id,
            is_completed=completion is not None,
            completed_at=completion.completed_at if completion is not None else None,
            progress=progress,
        )
    return result


def get_progress(db: Session, user: User, course_id: UUID) -> CourseProgress:
    _, enrollment = _enrolled_course(db, user, course_id)
    return CourseProgress.model_validate(
        _progress_values(repository.course_progress(db, enrollment.id))
    )


def dashboard(db: Session, user: User) -> StudentDashboard:
    courses = [_summary(row) for row in repository.student_courses(db, user.id)]
    completed = sum(course.is_completed for course in courses)
    return StudentDashboard(
        total_enrolled_courses=len(courses),
        completed_courses=completed,
        in_progress_courses=len(courses) - completed,
        courses=courses,
    )


def list_students(
    db: Session, user: User, course_id: UUID, *, page: int, page_size: int
) -> InstructorStudentPage:
    _owned_course(db, user, course_id)
    rows = repository.instructor_students(db, course_id, page=page, page_size=page_size)
    return InstructorStudentPage(
        items=[InstructorStudentRead.model_validate(_progress_values(row)) for row in rows],
        total=repository.course_student_count(db, course_id),
        page=page,
        page_size=page_size,
    )


def course_stats(db: Session, user: User, course_id: UUID) -> CourseStats:
    _owned_course(db, user, course_id)
    rows = repository.instructor_students(db, course_id)
    total_lessons = repository.lesson_count(db, course_id)
    completed = sum(total_lessons > 0 and row["completed_lessons"] == total_lessons for row in rows)
    return CourseStats(
        course_id=course_id,
        total_students=len(rows),
        completed_students=completed,
        in_progress_students=len(rows) - completed,
        average_progress_percentage=percentage(
            sum(row["completed_lessons"] for row in rows), len(rows) * total_lessons
        ),
        total_lessons=total_lessons,
    )
