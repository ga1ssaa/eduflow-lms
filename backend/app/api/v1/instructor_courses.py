from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.auth.dependencies import require_role
from app.auth.models import User
from app.courses import repository, service
from app.courses.schemas import (
    CourseCreate,
    CoursePage,
    CourseRead,
    CourseUpdate,
    LessonCreate,
    LessonRead,
    LessonUpdate,
    ModuleCreate,
    ModuleRead,
    ModuleUpdate,
    OrderUpdate,
    Status,
)
from app.db.session import get_db

router = APIRouter(prefix="/instructor", tags=["instructor courses"])
DB = Annotated[Session, Depends(get_db)]
Author = Annotated[User, Depends(require_role("instructor", "admin"))]


@router.get("/courses", response_model=CoursePage)
def list_courses(
    db: DB,
    user: Author,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Status | None = None,
) -> dict:
    return repository.list_courses(
        db, instructor_id=user.id, status=status, page=page, page_size=page_size
    )


@router.post("/courses", response_model=CourseRead, status_code=201)
def create_course(payload: CourseCreate, db: DB, user: Author) -> CourseRead:
    return service.create_course(db, user, payload)


@router.get("/courses/{course_id}", response_model=CourseRead)
def get_course(course_id: UUID, db: DB, user: Author) -> CourseRead:
    return service.get_course(db, user, course_id)


@router.patch("/courses/{course_id}", response_model=CourseRead)
def update_course(course_id: UUID, payload: CourseUpdate, db: DB, user: Author) -> CourseRead:
    return service.update_course(db, user, course_id, payload)


@router.delete("/courses/{course_id}", status_code=204)
def delete_course(course_id: UUID, db: DB, user: Author) -> Response:
    service.delete_course(db, user, course_id)
    return Response(status_code=204)


@router.post("/courses/{course_id}/publish", response_model=CourseRead)
def publish_course(course_id: UUID, db: DB, user: Author) -> CourseRead:
    return service.set_publication(db, user, course_id, published=True)


@router.post("/courses/{course_id}/unpublish", response_model=CourseRead)
def unpublish_course(course_id: UUID, db: DB, user: Author) -> CourseRead:
    return service.set_publication(db, user, course_id, published=False)


@router.post("/courses/{course_id}/modules", response_model=ModuleRead, status_code=201)
def create_module(course_id: UUID, payload: ModuleCreate, db: DB, user: Author) -> ModuleRead:
    return service.create_module(db, user, course_id, payload)


@router.patch("/modules/{module_id}", response_model=ModuleRead)
def update_module(module_id: UUID, payload: ModuleUpdate, db: DB, user: Author) -> ModuleRead:
    return service.update_module(db, user, module_id, payload)


@router.delete("/modules/{module_id}", status_code=204)
def delete_module(module_id: UUID, db: DB, user: Author) -> Response:
    service.delete_module(db, user, module_id)
    return Response(status_code=204)


@router.put("/courses/{course_id}/modules/order", response_model=list[ModuleRead])
def order_modules(course_id: UUID, payload: OrderUpdate, db: DB, user: Author) -> list[ModuleRead]:
    return service.order_modules(db, user, course_id, payload)


@router.post("/modules/{module_id}/lessons", response_model=LessonRead, status_code=201)
def create_lesson(module_id: UUID, payload: LessonCreate, db: DB, user: Author) -> LessonRead:
    return service.create_lesson(db, user, module_id, payload)


@router.patch("/lessons/{lesson_id}", response_model=LessonRead)
def update_lesson(lesson_id: UUID, payload: LessonUpdate, db: DB, user: Author) -> LessonRead:
    return service.update_lesson(db, user, lesson_id, payload)


@router.delete("/lessons/{lesson_id}", status_code=204)
def delete_lesson(lesson_id: UUID, db: DB, user: Author) -> Response:
    service.delete_lesson(db, user, lesson_id)
    return Response(status_code=204)


@router.put("/modules/{module_id}/lessons/order", response_model=list[LessonRead])
def order_lessons(module_id: UUID, payload: OrderUpdate, db: DB, user: Author) -> list[LessonRead]:
    return service.order_lessons(db, user, module_id, payload)
