from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import require_role
from app.auth.models import User
from app.db.session import get_db
from app.learning import service
from app.learning.schemas import (
    CompletionRead,
    CourseProgress,
    CourseStats,
    EmptyBody,
    EnrolledCoursePage,
    EnrollmentRead,
    InstructorStudentPage,
    StudentCourseRead,
    StudentDashboard,
    StudentLessonRead,
)

router = APIRouter(tags=["learning"])
DB = Annotated[Session, Depends(get_db)]
Student = Annotated[User, Depends(require_role("student"))]
Author = Annotated[User, Depends(require_role("instructor", "admin"))]
_EMPTY_BODY = EmptyBody()


@router.post("/courses/{course_id}/enroll", response_model=EnrollmentRead)
def enroll(
    course_id: UUID, db: DB, user: Student, payload: Annotated[EmptyBody, Body()] = _EMPTY_BODY
) -> EnrollmentRead:
    return service.enroll(db, user, course_id)


@router.get("/students/me/courses", response_model=EnrolledCoursePage)
def list_courses(
    db: DB,
    user: Student,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> EnrolledCoursePage:
    return service.list_courses(db, user, page=page, page_size=page_size)


@router.get("/students/me/courses/{course_id}", response_model=StudentCourseRead)
def get_course(course_id: UUID, db: DB, user: Student) -> StudentCourseRead:
    return service.get_course(db, user, course_id)


@router.get("/students/me/lessons/{lesson_id}", response_model=StudentLessonRead)
def get_lesson(lesson_id: UUID, db: DB, user: Student) -> StudentLessonRead:
    return service.get_lesson(db, user, lesson_id)


@router.post("/students/me/lessons/{lesson_id}/complete", response_model=CompletionRead)
def complete_lesson(
    lesson_id: UUID, db: DB, user: Student, payload: Annotated[EmptyBody, Body()] = _EMPTY_BODY
) -> CompletionRead:
    return service.set_completion(db, user, lesson_id, completed=True)


@router.delete("/students/me/lessons/{lesson_id}/complete", response_model=CompletionRead)
def uncomplete_lesson(lesson_id: UUID, db: DB, user: Student) -> CompletionRead:
    return service.set_completion(db, user, lesson_id, completed=False)


@router.get("/students/me/courses/{course_id}/progress", response_model=CourseProgress)
def get_progress(course_id: UUID, db: DB, user: Student) -> CourseProgress:
    return service.get_progress(db, user, course_id)


@router.get("/students/me/dashboard", response_model=StudentDashboard)
def dashboard(db: DB, user: Student) -> StudentDashboard:
    return service.dashboard(db, user)


@router.get("/instructor/courses/{course_id}/students", response_model=InstructorStudentPage)
def list_students(
    course_id: UUID,
    db: DB,
    user: Author,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> InstructorStudentPage:
    return service.list_students(db, user, course_id, page=page, page_size=page_size)


@router.get("/instructor/courses/{course_id}/stats", response_model=CourseStats)
def course_stats(course_id: UUID, db: DB, user: Author) -> CourseStats:
    return service.course_stats(db, user, course_id)
