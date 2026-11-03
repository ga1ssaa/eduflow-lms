from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from pydantic import HttpUrl, ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import NoResultFound

from app.auth.models import User
from app.courses import repository
from app.courses.models import Course, Lesson, Module
from app.courses.schemas import (
    CourseCreate,
    CourseRead,
    CourseUpdate,
    LessonCreate,
    LessonRead,
    LessonUpdate,
    ModuleCreate,
    ModuleRead,
    ModuleUpdate,
    OrderUpdate,
    PublicCourseDetail,
)


@contextmanager
def _write(db: Session) -> Iterator[None]:
    """Services own atomic writes, including rollback on business-rule rejection."""
    try:
        yield
        db.commit()
    except IntegrityError as error:
        db.rollback()
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        detail = "Slug already exists" if constraint == "ix_courses_slug" else "Course conflict"
        raise HTTPException(status_code=409, detail=detail) from error
    except Exception:
        db.rollback()
        raise


def _owned_course(
    db: Session, user: User, course_id: UUID, *, lock: bool = False, shared_lock: bool = False
) -> Course:
    course = repository.course_by_id(db, course_id, lock=lock, shared_lock=shared_lock)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    # Admin authority is explicit; instructor access always checks ownership.
    if user.role not in {"instructor", "admin"} or (
        user.role != "admin" and course.instructor_id != user.id
    ):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return course


def _module_course(db: Session, user: User, module_id: UUID) -> tuple[Course, Module]:
    course_id = repository.course_id_for_module(db, module_id)
    if course_id is None:
        raise HTTPException(status_code=404, detail="Module not found")
    course = _owned_course(db, user, course_id, lock=True)
    module = repository.module_by_id(db, module_id, course_id)
    if module is None:
        raise HTTPException(status_code=404, detail="Module not found")
    return course, module


def _lesson_course(db: Session, user: User, lesson_id: UUID) -> tuple[Course, Lesson]:
    course_id = repository.course_id_for_lesson(db, lesson_id)
    if course_id is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    course = _owned_course(db, user, course_id, lock=True)
    lesson = repository.lesson_by_id(db, lesson_id, course_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return course, lesson


def _validate_publication(db: Session, course: Course) -> None:
    # Flush first so a deleted/created/edited child is included in validation.
    db.flush()
    modules = repository.modules_for_course(db, course.id)
    lessons = repository.lessons_for_course(db, course.id)
    for lesson in lessons:
        if lesson.video_url:
            try:
                HttpUrl(lesson.video_url)
            except ValidationError:
                raise HTTPException(
                    status_code=409, detail="Course is incomplete for publication"
                ) from None
    if (
        not course.title.strip()
        or not course.description.strip()
        or not course.category.strip()
        or not modules
        or not lessons
        or any(
            not lesson.title.strip() or not (lesson.content.strip() or lesson.video_url)
            for lesson in lessons
        )
    ):
        raise HTTPException(status_code=409, detail="Course is incomplete for publication")


def _changed(db: Session, course: Course, module: Module | None = None) -> None:
    now = datetime.now(UTC)
    course.updated_at = now
    if module is not None:
        module.updated_at = now
    db.flush()
    if course.status == "published":
        _validate_publication(db, course)


def _assign_order(
    db: Session, items: list[Module] | list[Lesson], ids: list[UUID], *, modules: bool
) -> None:
    if len(ids) != len(items) or len(set(ids)) != len(ids) or set(ids) != {i.id for i in items}:
        raise HTTPException(
            status_code=409, detail="Order must contain every current ID exactly once"
        )
    repository.defer_positions(db, modules=modules)
    by_id = {item.id: item for item in items}
    for position, item_id in enumerate(ids, 1):
        by_id[item_id].position = position


def get_course(db: Session, user: User, course_id: UUID) -> CourseRead:
    _owned_course(db, user, course_id, shared_lock=True)
    return CourseRead.model_validate(repository.course_detail(db, course_id))


def public_course(db: Session, slug: str) -> PublicCourseDetail:
    course_id = repository.published_id_for_slug(db, slug)
    if course_id is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        return PublicCourseDetail.model_validate(
            repository.course_detail(db, course_id, public=True)
        )
    except NoResultFound:
        raise HTTPException(status_code=404, detail="Course not found") from None


def create_course(db: Session, user: User, payload: CourseCreate) -> CourseRead:
    with _write(db):
        course = Course(instructor_id=user.id, status="draft", **payload.model_dump())
        db.add(course)
        db.flush()
        result = CourseRead.model_validate(repository.course_detail(db, course.id))
    return result


def update_course(db: Session, user: User, course_id: UUID, payload: CourseUpdate) -> CourseRead:
    with _write(db):
        course = _owned_course(db, user, course_id, lock=True)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(course, field, value)
        _changed(db, course)
        result = CourseRead.model_validate(repository.course_detail(db, course.id))
    return result


def delete_course(db: Session, user: User, course_id: UUID) -> None:
    with _write(db):
        course = _owned_course(db, user, course_id, lock=True)
        if course.status == "published":
            raise HTTPException(status_code=409, detail="Unpublish the course before deleting it")
        # Explicit draft-course deletion intentionally cascades through its curriculum.
        db.delete(course)


def set_publication(db: Session, user: User, course_id: UUID, *, published: bool) -> CourseRead:
    with _write(db):
        course = _owned_course(db, user, course_id, lock=True)
        if published:
            _validate_publication(db, course)
            if course.status != "published":
                course.published_at = datetime.now(UTC)
            course.status = "published"
        else:
            course.status = "draft"
            course.published_at = None
        course.updated_at = datetime.now(UTC)
        db.flush()
        result = CourseRead.model_validate(repository.course_detail(db, course.id))
    return result


def create_module(db: Session, user: User, course_id: UUID, payload: ModuleCreate) -> ModuleRead:
    with _write(db):
        course = _owned_course(db, user, course_id, lock=True)
        modules = repository.modules_for_course(db, course_id)
        module = Module(
            course_id=course_id,
            title=payload.title,
            position=max((item.position for item in modules), default=0) + 1,
        )
        db.add(module)
        _changed(db, course)
        result = ModuleRead.model_validate(repository.module_detail(db, module.id))
    return result


def update_module(db: Session, user: User, module_id: UUID, payload: ModuleUpdate) -> ModuleRead:
    with _write(db):
        course, module = _module_course(db, user, module_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(module, field, value)
        _changed(db, course, module)
        result = ModuleRead.model_validate(repository.module_detail(db, module.id))
    return result


def delete_module(db: Session, user: User, module_id: UUID) -> None:
    with _write(db):
        course, module = _module_course(db, user, module_id)
        db.delete(module)
        db.flush()
        # Module deletion deliberately deletes its lessons, then closes the position gap.
        remaining = repository.modules_for_course(db, course.id)
        _assign_order(db, remaining, [item.id for item in remaining], modules=True)
        _changed(db, course)


def order_modules(
    db: Session, user: User, course_id: UUID, payload: OrderUpdate
) -> list[ModuleRead]:
    with _write(db):
        course = _owned_course(db, user, course_id, lock=True)
        modules = repository.modules_for_course(db, course_id)
        _assign_order(db, modules, payload.ids, modules=True)
        _changed(db, course)
        result = [
            ModuleRead.model_validate(module) for module in repository.modules_detail(db, course_id)
        ]
    return result


def create_lesson(db: Session, user: User, module_id: UUID, payload: LessonCreate) -> LessonRead:
    with _write(db):
        course, module = _module_course(db, user, module_id)
        lessons = repository.lessons_for_module(db, module.id)
        values = payload.model_dump()
        values["video_url"] = str(payload.video_url) if payload.video_url is not None else None
        lesson = Lesson(
            module_id=module.id,
            position=max((item.position for item in lessons), default=0) + 1,
            **values,
        )
        db.add(lesson)
        _changed(db, course, module)
        result = LessonRead.model_validate(lesson)
    return result


def update_lesson(db: Session, user: User, lesson_id: UUID, payload: LessonUpdate) -> LessonRead:
    with _write(db):
        course, lesson = _lesson_course(db, user, lesson_id)
        values = payload.model_dump(exclude_unset=True)
        if "video_url" in values and values["video_url"] is not None:
            values["video_url"] = str(values["video_url"])
        for field, value in values.items():
            setattr(lesson, field, value)
        module = repository.module_by_id(db, lesson.module_id, course.id)
        _changed(db, course, module)
        result = LessonRead.model_validate(lesson)
    return result


def delete_lesson(db: Session, user: User, lesson_id: UUID) -> None:
    with _write(db):
        course, lesson = _lesson_course(db, user, lesson_id)
        module = repository.module_by_id(db, lesson.module_id, course.id)
        db.delete(lesson)
        db.flush()
        remaining = repository.lessons_for_module(db, module.id)
        _assign_order(db, remaining, [item.id for item in remaining], modules=False)
        _changed(db, course, module)


def order_lessons(
    db: Session, user: User, module_id: UUID, payload: OrderUpdate
) -> list[LessonRead]:
    with _write(db):
        course, module = _module_course(db, user, module_id)
        lessons = repository.lessons_for_module(db, module_id)
        _assign_order(db, lessons, payload.ids, modules=False)
        _changed(db, course, module)
        result = [
            LessonRead.model_validate(lesson)
            for lesson in repository.lessons_for_module(db, module_id)
        ]
    return result
