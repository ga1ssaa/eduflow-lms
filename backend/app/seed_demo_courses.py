"""Explicit development-only demo seeding; importing this module never opens a database."""

import argparse
import sys
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.auth.models import User
from app.core.config import get_settings
from app.courses.models import Course, Lesson, Module
from app.courses.schemas import CourseCreate, LessonCreate, ModuleCreate
from app.courses.service import set_publication
from app.db.session import get_session_factory

SEED_NAMESPACE = uuid5(NAMESPACE_URL, "eduflow:demo-courses:v1")
EXPECTED_COURSES = {
    "demo-python-fundamentals": ("Python Fundamentals", 3),
    "demo-modern-react-development": ("Modern React Development", 3),
    "demo-ui-ux-design-essentials": ("UI/UX Design Essentials", 3),
    "demo-sql-postgresql": ("SQL & PostgreSQL", 3),
    "demo-fastapi-backend-development": ("FastAPI Backend Development", 3),
    "demo-javascript-essentials": ("JavaScript Essentials", 2),
    "demo-git-github-workflow": ("Git & GitHub Workflow", 2),
    "demo-web-development-foundations": ("Web Development Foundations", 2),
}


class DemoLesson(LessonCreate):
    video_url: None = Field(...)

    @model_validator(mode="after")
    def require_content(self) -> "DemoLesson":
        if not self.content.strip():
            raise ValueError("Every demo lesson requires text content")
        return self


class DemoModule(ModuleCreate):
    lessons: list[DemoLesson] = Field(min_length=3, max_length=3)


class DemoCourse(CourseCreate):
    modules: list[DemoModule] = Field(min_length=2, max_length=3)

    @model_validator(mode="after")
    def require_publication_fields(self) -> "DemoCourse":
        if not self.description.strip() or not self.category.strip():
            raise ValueError("Every demo course requires a description and category")
        return self


class DemoManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    courses: list[DemoCourse] = Field(min_length=8, max_length=8)

    @model_validator(mode="after")
    def require_exact_distribution(self) -> "DemoManifest":
        distribution = {course.slug: (course.title, len(course.modules)) for course in self.courses}
        modules = sum(len(course.modules) for course in self.courses)
        lessons = sum(len(module.lessons) for course in self.courses for module in course.modules)
        if distribution != EXPECTED_COURSES or modules != 21 or lessons != 63:
            raise ValueError("Expected the reserved eight courses, 21 modules, and 63 lessons")
        return self


class SeedConflict(ValueError):
    """Safe user-facing conflict message, never a raw database error."""


def load_manifest() -> DemoManifest:
    return DemoManifest.model_validate_json(
        Path(__file__).with_name("demo_courses.json").read_text(encoding="utf-8")
    )


def build_course(spec: DemoCourse, instructor_id: UUID) -> Course:
    course = Course(
        id=uuid5(SEED_NAMESPACE, spec.slug),
        instructor_id=instructor_id,
        status="draft",
        published_at=None,
        **spec.model_dump(exclude={"modules"}),
    )
    course.modules = []
    for position, module_spec in enumerate(spec.modules, 1):
        module = Module(
            id=uuid5(course.id, f"module/{position}"),
            course_id=course.id,
            position=position,
            title=module_spec.title,
        )
        module.lessons = [
            Lesson(
                id=uuid5(module.id, f"lesson/{lesson_position}"),
                module_id=module.id,
                position=lesson_position,
                **lesson.model_dump(),
            )
            for lesson_position, lesson in enumerate(module_spec.lessons, 1)
        ]
        course.modules.append(module)
    return course


def _fingerprint(course: Course) -> tuple:
    """Compare seeded identity and content, excluding database-managed timestamps."""
    return (
        course.id,
        course.instructor_id,
        course.title,
        course.slug,
        course.description,
        course.category,
        course.level,
        tuple(
            (
                module.id,
                module.course_id,
                module.title,
                module.position,
                tuple(
                    (
                        lesson.id,
                        lesson.module_id,
                        lesson.title,
                        lesson.content,
                        lesson.video_url,
                        lesson.position,
                    )
                    for lesson in sorted(module.lessons, key=lambda lesson: lesson.position)
                ),
            )
            for module in sorted(course.modules, key=lambda module: module.position)
        ),
    )


def _instructor(db: Session, instructor_id: UUID, *, lock: bool) -> User:
    query = select(User).where(User.id == instructor_id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update(read=True)
    user = db.scalar(query)
    if user is None or not user.is_active or user.role != "instructor":
        raise SeedConflict(
            "An existing active instructor UUID is required; accounts are not changed."
        )
    return user


def seed_courses(
    db: Session, manifest: DemoManifest, instructor_id: UUID, *, apply: bool = False
) -> tuple[int, int]:
    # Revalidate even programmatically supplied models before any database operation.
    manifest = DemoManifest.model_validate(manifest.model_dump())
    _instructor(db, instructor_id, lock=apply)
    expected = [build_course(spec, instructor_id) for spec in manifest.courses]
    existing = list(
        db.scalars(
            select(Course)
            .where(
                or_(
                    Course.id.in_([course.id for course in expected]),
                    Course.slug.in_([course.slug for course in expected]),
                )
            )
            .options(selectinload(Course.modules).selectinload(Module.lessons))
        )
    )
    missing, conflicts = [], []
    skipped = 0
    for course in expected:
        occupied = [item for item in existing if item.id == course.id or item.slug == course.slug]
        if not occupied:
            missing.append(course)
        elif (
            len(occupied) == 1
            and occupied[0].status == "published"
            and occupied[0].published_at is not None
            and _fingerprint(occupied[0]) == _fingerprint(course)
        ):
            skipped += 1
        else:
            conflicts.append(course.slug)
    if conflicts:
        raise SeedConflict("Existing records differ; nothing overwritten: " + ", ".join(conflicts))
    if apply:
        for course in missing:
            try:
                # Each complete course is one transaction. The existing publication
                # service validates, commits it, and rolls back any rejected write.
                instructor = _instructor(db, instructor_id, lock=True)
                db.add(course)
                db.flush()
                set_publication(db, instructor, course.id, published=True)
            except Exception:
                db.rollback()
                raise
            print(f"Created and published: {course.slug}")
    return len(missing), skipped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed original EduFlow demo courses explicitly")
    parser.add_argument("--instructor-id", type=UUID, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Inspect only; no database writes")
    mode.add_argument(
        "--apply", action="store_true", help="Create and publish missing demo courses"
    )
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest()
        settings = get_settings()
        if settings.environment != "development":
            raise SeedConflict("Demo seeding is allowed only with ENVIRONMENT=development.")
        with get_session_factory()() as db:
            created, skipped = seed_courses(db, manifest, args.instructor_id, apply=args.apply)
    except SeedConflict as error:
        print(str(error), file=sys.stderr)
        return 1
    except (ValidationError, OSError):
        print(
            "Invalid demo manifest, environment configuration, or publication output. "
            "Earlier completed courses may remain; no existing records were overwritten.",
            file=sys.stderr,
        )
        return 1
    except (SQLAlchemyError, HTTPException):
        print(
            "Seed stopped: database conflict/unavailable or publication rejected. "
            "Any uncommitted course was rolled back; earlier completed courses may remain.",
            file=sys.stderr,
        )
        return 1
    label = "created" if args.apply else "would_create"
    print(
        f"{label}={created}, skipped={skipped}. Demo manifest: 8 courses, 21 modules, 63 lessons."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
