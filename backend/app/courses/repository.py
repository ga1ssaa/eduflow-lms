from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.exc import NoResultFound

from app.auth.models import User
from app.courses.models import Course, Lesson, Module


def course_by_id(
    db: Session, course_id: UUID, *, lock: bool = False, shared_lock: bool = False
) -> Course | None:
    statement = select(Course).where(Course.id == course_id)
    if lock or shared_lock:
        # Refresh the row after waiting: callers must validate the latest committed state.
        statement = statement.with_for_update(read=shared_lock).execution_options(
            populate_existing=True
        )
    return db.scalar(statement)


def course_id_for_module(db: Session, module_id: UUID) -> UUID | None:
    return db.scalar(select(Module.course_id).where(Module.id == module_id))


def course_id_for_lesson(db: Session, lesson_id: UUID) -> UUID | None:
    return db.scalar(select(Module.course_id).join(Lesson).where(Lesson.id == lesson_id))


def module_by_id(db: Session, module_id: UUID, course_id: UUID) -> Module | None:
    return db.scalar(
        select(Module)
        .where(Module.id == module_id, Module.course_id == course_id)
        .execution_options(populate_existing=True)
    )


def lesson_by_id(db: Session, lesson_id: UUID, course_id: UUID) -> Lesson | None:
    return db.scalar(
        select(Lesson)
        .join(Module)
        .where(Lesson.id == lesson_id, Module.course_id == course_id)
        .execution_options(populate_existing=True)
    )


def modules_for_course(db: Session, course_id: UUID) -> list[Module]:
    return list(
        db.scalars(
            select(Module)
            .where(Module.course_id == course_id)
            .order_by(Module.position)
            .execution_options(populate_existing=True)
        )
    )


def lessons_for_module(db: Session, module_id: UUID) -> list[Lesson]:
    return list(
        db.scalars(
            select(Lesson)
            .where(Lesson.module_id == module_id)
            .order_by(Lesson.position)
            .execution_options(populate_existing=True)
        )
    )


def lessons_for_course(db: Session, course_id: UUID) -> list[Lesson]:
    return list(db.scalars(select(Lesson).join(Module).where(Module.course_id == course_id)))


def defer_positions(db: Session, *, modules: bool) -> None:
    # Constraint names are fixed application constants, never request input.
    constraint = "uq_modules_course_position" if modules else "uq_lessons_module_position"
    db.execute(text(f"SET CONSTRAINTS {constraint} DEFERRED"))


def _counts():
    module_count = select(func.count(Module.id)).where(Module.course_id == Course.id)
    lesson_count = (
        select(func.count(Lesson.id))
        .select_from(Lesson)
        .join(Module)
        .where(Module.course_id == Course.id)
    )
    return module_count.scalar_subquery(), lesson_count.scalar_subquery()


def _summary_columns(*, public: bool):
    modules, lessons = _counts()
    columns = [
        Course.id,
        Course.slug,
        Course.title,
        Course.description,
        Course.category,
        Course.level,
        User.full_name.label("instructor_name"),
        modules.label("module_count"),
        lessons.label("lesson_count"),
        Course.published_at,
    ]
    if not public:
        columns.extend([Course.instructor_id, Course.status, Course.created_at, Course.updated_at])
    return columns


def list_courses(
    db: Session,
    *,
    page: int,
    page_size: int,
    public: bool = False,
    instructor_id: UUID | None = None,
    status: str | None = None,
    search: str | None = None,
    category: str | None = None,
    level: str | None = None,
) -> dict:
    filters = []
    if public:
        filters.append(Course.status == "published")
    elif status is not None:
        filters.append(Course.status == status)
    if instructor_id is not None:
        filters.append(Course.instructor_id == instructor_id)
    if search:
        filters.append(Course.title.icontains(search, autoescape=True))
    if category:
        filters.append(Course.category == category)
    if level:
        filters.append(Course.level == level)
    total = db.scalar(select(func.count(Course.id)).where(*filters)) or 0
    statement = (
        select(*_summary_columns(public=public))
        .join(User, Course.instructor_id == User.id)
        .where(*filters)
        .order_by(Course.created_at.desc(), Course.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "items": [dict(row) for row in db.execute(statement).mappings()],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def course_detail(db: Session, course_id: UUID, *, public: bool = False) -> dict:
    filters = [Course.id == course_id]
    if public:
        filters.append(Course.status == "published")
        # Keep the published row stable across summary and select-in curriculum queries.
        # All authoring writes acquire the conflicting FOR UPDATE lock first.
        if db.scalar(select(Course.id).where(*filters).with_for_update(read=True)) is None:
            raise NoResultFound
    summary = dict(
        db.execute(
            select(*_summary_columns(public=public))
            .join(User, Course.instructor_id == User.id)
            .where(*filters)
        )
        .mappings()
        .one()
    )
    curriculum = selectinload(Course.modules).selectinload(Module.lessons)
    if public:
        # Public queries never fetch lesson content or video URLs, even temporarily.
        curriculum = curriculum.load_only(Lesson.id, Lesson.title, Lesson.position, raiseload=True)
    course = db.scalar(
        select(Course).where(*filters).options(curriculum).execution_options(populate_existing=True)
    )
    if course is None:
        raise NoResultFound
    summary["modules"] = course.modules
    return summary


def module_detail(db: Session, module_id: UUID) -> Module:
    return db.scalars(
        select(Module)
        .where(Module.id == module_id)
        .options(selectinload(Module.lessons))
        .execution_options(populate_existing=True)
    ).one()


def modules_detail(db: Session, course_id: UUID) -> list[Module]:
    return list(
        db.scalars(
            select(Module)
            .where(Module.course_id == course_id)
            .options(selectinload(Module.lessons))
            .order_by(Module.position)
            .execution_options(populate_existing=True)
        )
    )


def published_id_for_slug(db: Session, slug: str) -> UUID | None:
    return db.scalar(select(Course.id).where(Course.slug == slug, Course.status == "published"))
