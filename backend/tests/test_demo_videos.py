"""Sidecar validation/guard units and opt-in isolated PostgreSQL attachment proofs."""

from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from test_maintenance_postgres import database as maintenance_database  # noqa: F401
from test_maintenance_postgres import preserved_baseline, snapshot

from app import attach_demo_videos as videos
from app import seed_demo_courses as seed
from app.courses.models import Course, Lesson, Module


@pytest.fixture
def manifest():
    # Direct-looking test-only URLs are never fetched by these tests or the CLI.
    return videos.VideoManifest(
        videos=[
            videos.VideoAttachment(
                course_slug=slug,
                module_position=1,
                lesson_position=1,
                title=f"Test video {index}",
                video_url=f"https://upload.wikimedia.org/test/{index}.webm",
                source_url=f"https://commons.wikimedia.org/wiki/File:Test{index}.webm",
                author="Test author",
                license="CC BY 3.0",
                license_url="https://creativecommons.org/licenses/by/3.0/",
            )
            for index, slug in enumerate(list(seed.EXPECTED_COURSES)[:3])
        ]
    )


class MemorySession:
    def __init__(self, manifest):
        self.user = SimpleNamespace(id=uuid4(), role="instructor", is_active=True)
        specs = {c.slug: c for c in seed.load_manifest().courses}
        self.courses = [
            seed.build_course(specs[v.course_slug], self.user.id) for v in manifest.videos
        ]
        for course in self.courses:
            course.status, course.published_at = "published", datetime.now(UTC)
        self.statements, self.flushes = [], 0

    def scalar(self, query):
        self.statements.append(query)
        return self.user

    def scalars(self, query):
        self.statements.append(query)
        return self.courses

    def flush(self):
        self.flushes += 1


@pytest.fixture
def memory(manifest):
    return MemorySession(manifest)


@pytest.fixture(autouse=True)
def units_never_connect(request, monkeypatch):
    if request.node.get_closest_marker("integration"):
        return

    def forbidden(*args, **kwargs):
        pytest.fail("Video unit tests must never connect or create an engine")

    monkeypatch.setattr(videos, "create_engine", forbidden)
    monkeypatch.setattr(Engine, "connect", forbidden)
    monkeypatch.setattr("psycopg.connect", forbidden)
    for key in tuple(videos.os.environ):
        if key.upper().startswith("PG"):
            monkeypatch.delenv(key)


def test_real_sidecar_has_three_verified_targets_and_original_manifest_unchanged():
    approved = videos.load_manifest()
    assert len(approved.videos) == 3
    assert all(v.license == "CC BY 3.0" for v in approved.videos)
    assert "2012" in approved.videos[0].note
    original = seed.load_manifest()
    assert len(original.courses) == 8
    assert sum(len(c.modules) for c in original.courses) == 21
    assert sum(len(m.lessons) for c in original.courses for m in c.modules) == 63
    assert all(
        lesson.video_url is None
        for course in original.courses
        for module in course.modules
        for lesson in module.lessons
    )


@pytest.mark.parametrize(
    "change",
    ["count", "duplicate", "http", "credentials", "not-direct", "missing-license", "newline"],
)
def test_invalid_sidecar_refused(manifest, change):
    data = manifest.model_dump()
    if change == "count":
        data["videos"].pop()
    elif change == "duplicate":
        data["videos"][1] = deepcopy(data["videos"][0])
    elif change == "http":
        data["videos"][0]["video_url"] = "http://upload.wikimedia.org/test.webm"
    elif change == "credentials":
        data["videos"][0]["source_url"] = "https://private@example.test/source"
    elif change == "not-direct":
        data["videos"][0]["video_url"] = "https://example.test/watch"
    elif change == "missing-license":
        del data["videos"][0]["license_url"]
    else:
        data["videos"][0]["author"] = "Injected\ntext"
    with pytest.raises(ValidationError):
        videos.VideoManifest.model_validate(data)


def test_dryrun_unchanged_apply_repeat_exact_attribution_and_locks(memory, manifest):
    before = [seed._fingerprint(c) for c in memory.courses]
    assert videos.attach_videos(memory, manifest, memory.user.id) == (3, 0)
    assert [seed._fingerprint(c) for c in memory.courses] == before and memory.flushes == 0
    assert videos.attach_videos(memory, manifest, memory.user.id, apply=True) == (3, 0)
    assert memory.statements[-1]._for_update_arg is not None
    for course, video in zip(memory.courses, manifest.videos, strict=True):
        lesson = course.modules[0].lessons[0]
        assert lesson.content == videos.attributed_content(
            before[memory.courses.index(course)][-1][0][-1][0][3], video
        )
        assert lesson.video_url == video.video_url
        assert all(
            value in lesson.content for value in [video.author, video.source_url, video.license_url]
        )
    after = [seed._fingerprint(c) for c in memory.courses]
    assert videos.attach_videos(memory, manifest, memory.user.id, apply=True) == (0, 3)
    assert [seed._fingerprint(c) for c in memory.courses] == after
    assert memory.flushes == 1


@pytest.mark.parametrize(
    "change",
    ["content", "video", "title", "owner", "draft", "missing", "renamed", "unselected-lesson"],
)
def test_late_conflict_preflights_all_without_writes(memory, manifest, change):
    course = memory.courses[-1]
    if change == "content":
        course.modules[0].lessons[0].content += " User edit"
    elif change == "video":
        course.modules[0].lessons[0].video_url = "https://example.test/owned.webm"
    elif change == "title":
        course.title += " edited"
    elif change == "owner":
        course.instructor_id = uuid4()
    elif change == "draft":
        course.status = "draft"
    elif change == "missing":
        memory.courses.pop()
    elif change == "renamed":
        course.slug += "-renamed"
    else:
        course.modules[-1].lessons[-1].content += " edited"
    before = [seed._fingerprint(c) for c in memory.courses]
    with pytest.raises(seed.SeedConflict):
        videos.attach_videos(memory, manifest, memory.user.id, apply=True)
    assert [seed._fingerprint(c) for c in memory.courses] == before and memory.flushes == 0


@pytest.mark.parametrize("role,active", [("student", True), ("admin", True), ("instructor", False)])
def test_owner_must_be_active_instructor(memory, manifest, role, active):
    memory.user.role, memory.user.is_active = role, active
    with pytest.raises(seed.SeedConflict):
        videos.attach_videos(memory, manifest, memory.user.id, apply=True)
    assert memory.flushes == 0


@pytest.mark.parametrize(
    "environment,host,query",
    [
        ("test", "127.0.0.1", ""),
        ("development", "external.example", ""),
        ("development", "127.0.0.1", "?dbname=other"),
    ],
)
def test_local_target_refused(environment, host, query):
    settings = SimpleNamespace(
        environment=environment,
        database_url=f"postgresql+psycopg://qa@{host}:51736/eduflow_test_videos_unit{query}",
    )
    with pytest.raises(videos.ImportRefused):
        videos._guard_target(settings, host, "eduflow_test_videos_unit")


def test_local_exact_and_production_guard_delegation(monkeypatch):
    settings = SimpleNamespace(
        environment="development",
        database_url="postgresql+psycopg://qa@127.0.0.1:51736/eduflow_test_videos_unit?sslmode=disable",
    )
    assert videos._guard_target(settings, "127.0.0.1", "eduflow_test_videos_unit").port == 51736
    with pytest.raises(videos.ImportRefused):
        videos._guard_target(settings, "localhost", "eduflow_test_videos_unit")
    monkeypatch.setenv("PGHOSTADDR", "other")
    with pytest.raises(videos.ImportRefused):
        videos._guard_target(settings, "127.0.0.1", "eduflow_test_videos_unit")
    delegated = Mock(side_effect=videos.ImportRefused("Production target verification failed"))
    monkeypatch.setattr(videos, "guard_production_target", delegated)
    settings.environment = "production"
    with pytest.raises(videos.ImportRefused):
        videos._guard_target(settings, "expected", "database")
    delegated.assert_called_once_with(settings, "expected", "database")


def test_cli_default_dryrun_production_confirmation_and_safe_failure(monkeypatch, manifest, capsys):
    settings = SimpleNamespace(environment="development")
    monkeypatch.setattr(videos, "get_settings", lambda: settings)
    monkeypatch.setattr(videos, "_guard_target", lambda *args: object())
    monkeypatch.setattr(videos, "load_manifest", lambda: manifest)
    run = Mock(return_value=(3, 0))
    monkeypatch.setattr(videos, "_run", run)
    args = [
        "--instructor-id",
        str(uuid4()),
        "--expected-host",
        "127.0.0.1",
        "--expected-database",
        "test",
    ]
    assert videos.main(args) == 0 and run.call_args.kwargs["apply"] is False
    assert "would_attach=3" in capsys.readouterr().out
    settings.environment = "production"
    run.reset_mock()
    assert videos.main([*args, "--apply"]) == 1 and not run.called
    run.side_effect = SQLAlchemyError("private-dsn-and-password")
    assert videos.main([*args, "--apply", "--confirm-production", videos.CONFIRMATION]) == 1
    output = capsys.readouterr()
    assert not output.out and "private-dsn" not in output.err and "read-only dry run" in output.err


@pytest.fixture
def video_database(request, monkeypatch):
    database = request.getfixturevalue("maintenance_database")
    with Session(database.engine) as db:
        seed.seed_courses(db, seed.load_manifest(), database.owner, apply=True)
    monkeypatch.setattr(videos, "get_settings", lambda: database.settings)
    monkeypatch.setattr(videos, "_guard_target", lambda *args: database.url)
    return database


def _invoke(database, *, apply=False):
    args = [
        "--instructor-id",
        str(database.owner),
        "--expected-host",
        database.url.host,
        "--expected-database",
        database.url.database,
    ]
    if apply:
        args += ["--apply", "--confirm-production", videos.CONFIRMATION]
    return videos.main(args)


@pytest.mark.integration
def test_postgres_attachment_exact_three_repeat_and_preserved_learning(video_database):
    database = video_database
    before = snapshot(database.engine)
    assert _invoke(database, apply=True) == 0
    with Session(database.engine) as db:
        courses = list(db.scalars(select(Course).where(Course.slug.like("demo-%"))))
        lessons = list(
            db.scalars(select(Lesson).join(Module).join(Course).where(Course.slug.like("demo-%")))
        )
        assert len(courses) == 8 and len(lessons) == 63
        assert sum(lesson.video_url is not None for lesson in lessons) == 3
        assert sum("Video attribution:" in lesson.content for lesson in lessons) == 3
    after = snapshot(database.engine)
    assert all(
        after[t] == before[t]
        for t in (
            "users",
            "refresh_sessions",
            "courses",
            "modules",
            "enrollments",
            "lesson_progress",
        )
    )
    assert _invoke(database, apply=True) == 0 and snapshot(database.engine) == after
    preserved_baseline(database)


@pytest.mark.integration
def test_postgres_conflict_never_overwrites_or_partially_attaches(video_database):
    database = video_database
    with Session(database.engine) as db:
        lesson = db.scalar(
            select(Lesson)
            .join(Module)
            .join(Course)
            .where(Course.slug == "demo-web-development-foundations")
            .order_by(Lesson.id)
        )
        lesson.content += " Deliberate test-owned edit"
        db.commit()
    before = snapshot(database.engine)
    assert _invoke(database, apply=True) == 1
    assert snapshot(database.engine) == before
    preserved_baseline(database)


@pytest.mark.integration
@pytest.mark.parametrize("failure", ["flush", "root-commit"])
def test_postgres_attachment_rolls_back_failure(video_database, monkeypatch, failure, capsys):
    database = video_database
    before = snapshot(database.engine)
    if failure == "flush":
        original = videos.attach_videos

        def fail(*args, **kwargs):
            original(*args, **kwargs)
            raise SQLAlchemyError("Injected after real flush")

        monkeypatch.setattr(videos, "attach_videos", fail)
        assert _invoke(database, apply=True) == 1
    else:

        def fail_commit(connection):
            if connection.engine.url.database == database.url.database:
                raise SQLAlchemyError("Injected before physical root commit")

        event.listen(Engine, "commit", fail_commit)
        try:
            assert _invoke(database, apply=True) == 1
        finally:
            event.remove(Engine, "commit", fail_commit)
    assert "attached=" not in capsys.readouterr().out
    assert snapshot(database.engine) == before
    preserved_baseline(database)


@pytest.mark.integration
def test_postgres_dryrun_database_enforces_readonly(video_database, monkeypatch):
    database = video_database
    before = snapshot(database.engine)
    original = videos.attach_videos

    def inspect(db, *args, **kwargs):
        assert db.connection().exec_driver_sql("SHOW transaction_read_only").scalar_one() == "on"
        return original(db, *args, **kwargs)

    monkeypatch.setattr(videos, "attach_videos", inspect)
    assert _invoke(database) == 0
    assert snapshot(database.engine) == before
