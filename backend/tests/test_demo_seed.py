"""Database-free seed orchestration tests; no engine, migrations, or SQL execution."""

from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app import seed_demo_courses as seed
from app.auth.models import User
from app.courses import repository


class MemorySession:
    """A transaction double, deliberately not a SQLAlchemy database/session."""

    def __init__(self):
        self.user = User(
            id=uuid4(), full_name="Existing Instructor", role="instructor", is_active=True
        )
        self.courses = {}
        self.pending = []
        self.commits = 0
        self.rollbacks = 0
        self.reads = 0
        self.flushes = 0
        self.fail_flush = False
        self.invalidate_lesson = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self.pending:
            self.rollback()

    def scalar(self, _):
        self.reads += 1
        return self.user

    def scalars(self, _):
        self.reads += 1
        return list(self.courses.values())

    def add(self, course):
        self.pending.append(course)

    def flush(self):
        self.flushes += 1
        if self.fail_flush:
            raise IntegrityError("simulated duplicate insert", {}, Exception("private DB detail"))
        for course in self.pending:
            for item in [course, *course.modules, *self.lessons(course.id)]:
                if item.created_at is None:
                    item.created_at = datetime.now(UTC)
                if item.updated_at is None:
                    item.updated_at = item.created_at
            if self.invalidate_lesson:
                course.modules[0].lessons[0].content = ""

    def lookup(self, course_id):
        return next(
            (course for course in self.pending if course.id == course_id),
            self.courses.get(course_id),
        )

    def lessons(self, course_id):
        return [lesson for module in self.lookup(course_id).modules for lesson in module.lessons]

    def commit(self):
        self.commits += 1
        self.courses.update({course.id: course for course in self.pending})
        self.pending.clear()

    def rollback(self):
        self.rollbacks += 1
        self.pending.clear()


@pytest.fixture(autouse=True)
def no_database(monkeypatch):
    def forbidden(*_, **__):
        pytest.fail("Seed unit tests must never create an engine or open a configured database")

    monkeypatch.setattr("app.db.session.create_engine", forbidden)
    monkeypatch.setattr(seed, "get_session_factory", forbidden)


@pytest.fixture
def db(monkeypatch):
    session = MemorySession()
    # Keep the real publication service and its validation/commit/rollback logic;
    # replace only repository reads with this in-memory transaction double.
    monkeypatch.setattr(repository, "course_by_id", lambda db, id, **_: db.lookup(id))
    monkeypatch.setattr(repository, "modules_for_course", lambda db, id: db.lookup(id).modules)
    monkeypatch.setattr(repository, "lessons_for_course", lambda db, id: db.lessons(id))

    def detail(db, id):
        course = db.lookup(id)
        return {
            **{
                field: getattr(course, field)
                for field in (
                    "id",
                    "instructor_id",
                    "title",
                    "slug",
                    "description",
                    "category",
                    "level",
                    "status",
                    "created_at",
                    "updated_at",
                    "published_at",
                )
            },
            "instructor_name": db.user.full_name,
            "module_count": len(course.modules),
            "lesson_count": len(db.lessons(id)),
            "modules": course.modules,
        }

    monkeypatch.setattr(repository, "course_detail", detail)
    return session


def test_manifest_exact_distribution_original_text_and_deterministic_graph():
    manifest = seed.load_manifest()
    assert len(manifest.courses) == 8
    assert {course.slug: (course.title, len(course.modules)) for course in manifest.courses} == (
        seed.EXPECTED_COURSES
    )
    assert sum(len(course.modules) for course in manifest.courses) == 21
    instructor_id = uuid4()
    first = [seed.build_course(course, instructor_id) for course in manifest.courses]
    second = [seed.build_course(course, instructor_id) for course in manifest.courses]
    assert [seed._fingerprint(course) for course in first] == [
        seed._fingerprint(course) for course in second
    ]
    identifiers, contents = [], []
    for course in first:
        identifiers.append(course.id)
        assert course.instructor_id == instructor_id
        assert course.status == "draft" and course.published_at is None
        assert [module.position for module in course.modules] == list(
            range(1, len(course.modules) + 1)
        )
        for module in course.modules:
            identifiers.append(module.id)
            assert module.course_id == course.id
            assert [lesson.position for lesson in module.lessons] == [1, 2, 3]
            for lesson in module.lessons:
                identifiers.append(lesson.id)
                assert lesson.module_id == module.id
                assert lesson.video_url is None
                assert lesson.content.startswith("Explanation: ")
                assert "\n\nExample: " in lesson.content
                assert "\n\nExercise: " in lesson.content
                contents.append(lesson.content)
    assert len(contents) == len(set(contents)) == 63
    assert len(identifiers) == len(set(identifiers)) == 92
    assert all(identifier.version == 5 for identifier in identifiers)


@pytest.mark.parametrize(
    "mutation",
    [
        "course-count",
        "module-count",
        "lesson-count",
        "duplicate-slug",
        "unreserved-slug",
        "wrong-title",
        "blank-description",
        "blank-category",
        "blank-content",
        "blank-title",
        "video",
        "missing-video",
        "nul",
        "role-injection",
    ],
)
def test_invalid_manifest_is_rejected(mutation):
    data = seed.load_manifest().model_dump()
    course = data["courses"][0]
    lesson = course["modules"][0]["lessons"][0]
    if mutation == "course-count":
        data["courses"].pop()
    elif mutation == "module-count":
        course["modules"].pop()
    elif mutation == "lesson-count":
        course["modules"][0]["lessons"].pop()
    elif mutation == "duplicate-slug":
        data["courses"][1]["slug"] = course["slug"]
    elif mutation == "unreserved-slug":
        course["slug"] = "user-course"
    elif mutation == "wrong-title":
        course["title"] = "Unexpected course"
    elif mutation == "blank-description":
        course["description"] = " "
    elif mutation == "blank-category":
        course["category"] = " "
    elif mutation == "blank-content":
        lesson["content"] = " "
    elif mutation == "blank-title":
        lesson["title"] = " "
    elif mutation == "video":
        lesson["video_url"] = "https://example.test/video"
    elif mutation == "missing-video":
        del lesson["video_url"]
    elif mutation == "nul":
        lesson["content"] = "invalid\x00content"
    else:
        course["instructor_id"] = str(uuid4())
    with pytest.raises(ValidationError):
        seed.DemoManifest.model_validate(data)


def test_revalidation_happens_before_database_reads_or_writes(db):
    manifest = seed.load_manifest()
    manifest.courses[-1].modules[-1].lessons[-1].content = ""
    with pytest.raises(ValidationError):
        seed.seed_courses(db, manifest, db.user.id, apply=True)
    assert db.reads == db.flushes == db.commits == 0
    assert not db.pending


def test_dry_run_has_no_writes(db):
    assert seed.seed_courses(db, seed.load_manifest(), db.user.id) == (8, 0)
    assert not db.pending and not db.courses
    assert db.commits == db.flushes == 0


def test_apply_publishes_exact_curriculum_and_repeated_run_skips_without_updates(db):
    manifest = seed.load_manifest()
    assert seed.seed_courses(db, manifest, db.user.id, apply=True) == (8, 0)
    before = [
        (seed._fingerprint(course), course.published_at, course.updated_at)
        for course in db.courses.values()
    ]
    assert all(
        course.status == "published" and course.published_at for course in db.courses.values()
    )
    assert sum(len(course.modules) for course in db.courses.values()) == 21
    assert sum(len(db.lessons(id)) for id in db.courses) == 63
    assert seed.seed_courses(db, manifest, db.user.id, apply=True) == (0, 8)
    assert before == [
        (seed._fingerprint(course), course.published_at, course.updated_at)
        for course in db.courses.values()
    ]
    assert db.commits == 8


@pytest.mark.parametrize("change", ["slug-collision", "renamed", "content", "draft", "owner"])
def test_conflicting_records_are_preserved_without_any_new_writes(db, change):
    manifest = seed.load_manifest()
    course = seed.build_course(manifest.courses[0], db.user.id)
    course.status, course.published_at = "published", datetime.now(UTC)
    if change == "slug-collision":
        course.id = uuid4()
    elif change == "renamed":
        course.slug = "my-renamed-course"
    elif change == "content":
        course.modules[0].lessons[0].content = "User-edited lesson"
    elif change == "draft":
        course.status, course.published_at = "draft", None
    else:
        course.instructor_id = uuid4()
    db.courses[course.id] = course
    before = deepcopy(seed._fingerprint(course))
    with pytest.raises(seed.SeedConflict, match="nothing overwritten"):
        seed.seed_courses(db, manifest, db.user.id, apply=True)
    assert seed._fingerprint(course) == before
    assert len(db.courses) == 1 and not db.pending
    assert db.commits == db.flushes == 0


def test_unrelated_course_is_left_alone(db):
    unrelated = seed.build_course(seed.load_manifest().courses[0], db.user.id)
    unrelated.id, unrelated.slug = uuid4(), "personal-course"
    db.courses[unrelated.id] = unrelated
    assert seed.seed_courses(db, seed.load_manifest(), db.user.id, apply=True) == (8, 0)
    assert db.courses[unrelated.id] is unrelated
    assert unrelated.status == "draft"


@pytest.mark.parametrize("role,active", [("student", True), ("admin", True), ("instructor", False)])
def test_only_an_active_instructor_can_own_seeds(db, role, active):
    db.user.role, db.user.is_active = role, active
    with pytest.raises(seed.SeedConflict, match="active instructor"):
        seed.seed_courses(db, seed.load_manifest(), db.user.id, apply=True)
    assert not db.pending and db.commits == 0


def test_missing_instructor_is_rejected(db):
    db.user = None
    with pytest.raises(seed.SeedConflict):
        seed.seed_courses(db, seed.load_manifest(), uuid4())
    assert db.commits == 0


def test_insert_conflict_rolls_back_the_complete_current_course(db):
    db.fail_flush = True
    with pytest.raises(IntegrityError):
        seed.seed_courses(db, seed.load_manifest(), db.user.id, apply=True)
    assert db.rollbacks == 1
    assert not db.courses and not db.pending


def test_existing_publication_validation_rejects_and_rolls_back_incomplete_curriculum(db):
    db.invalidate_lesson = True
    with pytest.raises(HTTPException) as error:
        seed.seed_courses(db, seed.load_manifest(), db.user.id, apply=True)
    assert error.value.status_code == 409
    assert not db.courses and not db.pending
    assert db.commits == 0 and db.rollbacks >= 1


def test_partial_run_can_resume_without_rewriting_completed_courses(db, monkeypatch):
    original = seed.set_publication

    def publish(db, *args, **kwargs):
        if db.commits == 1:
            raise SQLAlchemyError("private failure")
        return original(db, *args, **kwargs)

    monkeypatch.setattr(seed, "set_publication", publish)
    with pytest.raises(SQLAlchemyError):
        seed.seed_courses(db, seed.load_manifest(), db.user.id, apply=True)
    assert len(db.courses) == 1 and not db.pending
    first = next(iter(db.courses.values()))
    timestamp = first.published_at
    monkeypatch.setattr(seed, "set_publication", original)
    assert seed.seed_courses(db, seed.load_manifest(), db.user.id, apply=True) == (7, 1)
    assert first.published_at == timestamp and len(db.courses) == 8


@pytest.mark.parametrize("environment", ["production", "test"])
def test_cli_rejects_non_development_before_opening_a_session(monkeypatch, environment, capsys):
    monkeypatch.setattr(seed, "get_settings", lambda: SimpleNamespace(environment=environment))
    assert seed.main(["--instructor-id", str(uuid4()), "--apply"]) == 1
    assert "only with ENVIRONMENT=development" in capsys.readouterr().err


def test_cli_dry_run_and_safe_failure_messages(db, monkeypatch, capsys):
    monkeypatch.setattr(seed, "get_settings", lambda: SimpleNamespace(environment="development"))
    monkeypatch.setattr(seed, "get_session_factory", lambda: lambda: db)
    assert seed.main(["--instructor-id", str(db.user.id), "--dry-run"]) == 0
    assert "would_create=8, skipped=0" in capsys.readouterr().out
    assert db.commits == db.flushes == 0
    db.fail_flush = True
    assert seed.main(["--instructor-id", str(db.user.id), "--apply"]) == 1
    output = capsys.readouterr()
    assert "private DB detail" not in output.err + output.out
    assert "rolled back" in output.err


def test_cli_invalid_manifest_never_opens_a_session(monkeypatch, capsys):
    def invalid():
        return seed.DemoManifest.model_validate({"courses": []})

    monkeypatch.setattr(seed, "load_manifest", invalid)
    assert seed.main(["--instructor-id", str(uuid4()), "--apply"]) == 1
    assert "Invalid demo manifest" in capsys.readouterr().err


@pytest.mark.parametrize("flags", [[], ["--dry-run", "--apply"]])
def test_cli_requires_one_explicit_mode(flags):
    with pytest.raises(SystemExit) as error:
        seed.main(["--instructor-id", str(uuid4()), *flags])
    assert error.value.code == 2
