from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.courses import repository, service
from app.courses.schemas import Level, PublicCourseDetail, PublicCoursePage, Slug
from app.db.session import get_db

router = APIRouter(prefix="/courses", tags=["courses"])
DB = Annotated[Session, Depends(get_db)]


@router.get("", response_model=PublicCoursePage)
def list_courses(
    db: DB,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200, pattern=r"^[^\x00]*$"),
    category: str | None = Query(default=None, max_length=100, pattern=r"^[^\x00]*$"),
    level: Level | None = None,
) -> dict:
    return repository.list_courses(
        db,
        public=True,
        page=page,
        page_size=page_size,
        search=search,
        category=category,
        level=level,
    )


@router.get("/{slug}", response_model=PublicCourseDetail)
def get_course(slug: Slug, db: DB) -> PublicCourseDetail:
    return service.public_course(db, slug)
