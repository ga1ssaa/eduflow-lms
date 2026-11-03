from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import require_role
from app.auth.models import User
from app.courses import repository, service
from app.courses.schemas import CoursePage, CourseRead, Status
from app.db.session import get_db

router = APIRouter(prefix="/admin/courses", tags=["admin courses"])
DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[User, Depends(require_role("admin"))]


@router.get("", response_model=CoursePage)
def list_courses(
    db: DB,
    user: Admin,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Status | None = None,
    search: str | None = Query(default=None, max_length=200, pattern=r"^[^\x00]*$"),
) -> dict:
    return repository.list_courses(db, status=status, search=search, page=page, page_size=page_size)


@router.get("/{course_id}", response_model=CourseRead)
def get_course(course_id: UUID, db: DB, user: Admin) -> CourseRead:
    return service.get_course(db, user, course_id)


@router.post("/{course_id}/publish", response_model=CourseRead)
def publish_course(course_id: UUID, db: DB, user: Admin) -> CourseRead:
    return service.set_publication(db, user, course_id, published=True)


@router.post("/{course_id}/unpublish", response_model=CourseRead)
def unpublish_course(course_id: UUID, db: DB, user: Admin) -> CourseRead:
    return service.set_publication(db, user, course_id, published=False)
