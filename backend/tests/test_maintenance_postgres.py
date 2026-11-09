"""Real local PostgreSQL atomicity proof, not Neon/TLS or live-account verification.

Only the CLI target adapter is replaced. Engines, transactions, savepoints,
registration, publication and persistence remain real. Databases are retained.
"""

import hashlib
import json
import os
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from alembic import command
from app import import_demo_courses as importer
from app import provision_production_instructor as provisioner
from app import seed_demo_courses as seed
from app.auth.models import RefreshSession, User
from app.auth.security import hash_password, verify_password
from app.core.config import Settings, get_settings
from app.courses import repository, service
from app.courses.models import Course, Lesson, Module
from app.learning.models import Enrollment, LessonProgress
from testutils.database import guard_test_database_url

pytestmark = pytest.mark.integration
TABLES = (
    "users",
    "refresh_sessions",
    "courses",
    "modules",
    "lessons",
    "enrollments",
    "lesson_progress",
)


class PrivateFixture(SimpleNamespace):
    def __repr__(self):
        return "<isolated maintenance fixture>"


def local_target(raw):
    url = guard_test_database_url(raw)
    if url.host != "127.0.0.1" or not url.port or url.port == 5432:
        raise ValueError("Maintenance tests require the explicitly isolated local server")
    if not url.database.startswith("eduflow_test_maintenance_"):
        raise ValueError("Maintenance tests require their dedicated database namespace")
    return url.set(drivername="postgresql+psycopg")


def verify_server(connection, url, directory):
    # Every check is read-only and precedes CREATE DATABASE or Alembic writes.
    actual = connection.exec_driver_sql("SHOW data_directory").scalar_one()
    assert actual == str(directory), "Unexpected PostgreSQL data directory"
    assert connection.exec_driver_sql("SHOW listen_addresses").scalar_one() == "127.0.0.1"
    assert connection.exec_driver_sql("SELECT current_database()").scalar_one() == url.database
    assert connection.exec_driver_sql("SHOW port").scalar_one() == str(url.port)


def digest_rows(connection, table, ids=None):
    # Only static table names; no data, password hashes or tokens in failure output.
    query = text(f'SELECT * FROM "{table}" ORDER BY id')
    rows = [dict(row) for row in connection.execute(query).mappings()]
    if ids is not None:
        rows = [row for row in rows if str(row["id"]) in ids]
    return hashlib.sha256(json.dumps(rows, default=str, sort_keys=True).encode()).hexdigest()


def snapshot(engine):
    with engine.connect() as connection:
        return {table: digest_rows(connection, table) for table in TABLES}


def preserved_baseline(database):
    with database.engine.connect() as connection:
        for table in TABLES:
            assert digest_rows(connection, table, database.ids[table]) == database.baseline[table]


@pytest.fixture
def database(monkeypatch):
    raw = os.environ.get("EDUFLOW_MAINTENANCE_TEST_URL")
    directory_raw = os.environ.get("EDUFLOW_MAINTENANCE_DATA_DIR")
    if not raw or not directory_raw:
        pytest.skip("Set both isolated maintenance PostgreSQL test settings explicitly")
    # Remove libpq defaults before validating or opening any connection.
    for key in tuple(os.environ):
        if key.upper().startswith("PG"):
            monkeypatch.delenv(key)
    directory = Path(directory_raw)
    if (
        not directory.is_absolute()
        or directory.parent.parent != Path("/private/tmp")
        or not directory.parent.name.startswith("eduflow-maintenance-")
        or directory.name != "pgdata"
        or directory.resolve() != directory
        or not directory.is_dir()
    ):
        pytest.fail("Maintenance tests require the dedicated private temporary cluster directory")
    base_url = local_target(raw)
    base_engine = create_engine(base_url, poolclass=NullPool, hide_parameters=True)
    name = f"eduflow_test_maintenance_{uuid4().hex}"
    try:
        with base_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            verify_server(connection, base_url, directory)
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    finally:
        base_engine.dispose()
    url = local_target(base_url.set(database=name).render_as_string(hide_password=False))
    engine = create_engine(url, poolclass=NullPool, hide_parameters=True)
    try:
        with engine.connect() as connection:
            verify_server(connection, url, directory)
        monkeypatch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))
        monkeypatch.setenv("ENVIRONMENT", "test")
        get_settings.cache_clear()
        backend = Path(__file__).resolve().parents[1]
        config = Config(str(backend / "alembic.ini"))
        config.set_main_option("script_location", str(backend / "alembic"))
        command.upgrade(config, "head")
        with engine.connect() as connection:
            verify_server(connection, url, directory)
        settings = Settings(
            _env_file=None,
            database_url=url.render_as_string(hide_password=False),
            jwt_secret=secrets.token_urlsafe(48),
            environment="production",
            refresh_cookie_secure=True,
            auth_allowed_origins=[],
            cors_origins=[],
        )

        def adapter(actual_settings, expected_host, expected_database):
            target = local_target(str(actual_settings.database_url))
            assert target == url
            assert expected_host == url.host and expected_database == url.database
            return target

        for module in (importer, provisioner):
            monkeypatch.setattr(module, "_guard_target", adapter)
            monkeypatch.setattr(module, "get_settings", lambda: settings)
        password = f"Qa9!{secrets.token_urlsafe(24)}"
        with Session(engine) as db:
            owner = User(
                email="existing-owner@example.com",
                full_name="Existing Owner",
                role="instructor",
                password_hash=hash_password(password),
            )
            student = User(
                email="existing-student@example.com",
                full_name="Existing Student",
                role="student",
                password_hash=hash_password(password),
            )
            db.add_all([owner, student])
            db.flush()
            unrelated = Course(
                instructor_id=owner.id,
                title="Existing curriculum",
                slug="existing-curriculum",
                description="Existing text",
                category="Existing",
                level="beginner",
            )
            db.add(unrelated)
            db.flush()
            module = Module(course_id=unrelated.id, title="Existing module", position=1)
            db.add(module)
            db.flush()
            lesson = Lesson(
                module_id=module.id,
                title="Existing lesson",
                position=1,
                content="Existing private content",
            )
            db.add(lesson)
            db.commit()
            service.set_publication(db, owner, unrelated.id, published=True)
            enrollment = Enrollment(student_id=student.id, course_id=unrelated.id)
            db.add(enrollment)
            db.flush()
            db.add_all(
                [
                    LessonProgress(enrollment_id=enrollment.id, lesson_id=lesson.id),
                    RefreshSession(
                        user_id=student.id,
                        token_hash=secrets.token_hex(32),
                        expires_at=datetime.now(UTC) + timedelta(days=1),
                    ),
                ]
            )
            db.commit()
            owner_id = owner.id
        with engine.connect() as connection:
            ids = {
                table: {
                    str(value)
                    for value in connection.execute(text(f'SELECT id FROM "{table}"')).scalars()
                }
                for table in TABLES
            }
        fixture = PrivateFixture(
            engine=engine,
            url=url,
            settings=settings,
            owner=owner_id,
            password=password,
            ids=ids,
            baseline=snapshot(engine),
        )
        yield fixture
    finally:
        engine.dispose()
        get_settings.cache_clear()


def provision(database, monkeypatch, email=" New-Instructor@Example.com "):
    monkeypatch.setattr(provisioner.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(provisioner.getpass, "getpass", lambda _: database.password)
    return provisioner.main(
        [
            "--email",
            email,
            "--full-name",
            "New Instructor",
            "--expected-host",
            database.url.host,
            "--expected-database",
            database.url.database,
            "--confirm-production-provisioning",
            importer.CONFIRMATION,
        ]
    )


def import_courses(database, *, apply):
    args = [
        "--instructor-id",
        str(database.owner),
        "--expected-host",
        database.url.host,
        "--expected-database",
        database.url.database,
        "--apply" if apply else "--dry-run",
    ]
    if apply:
        args += ["--confirm-production-import", importer.CONFIRMATION]
    return importer.main(args)


def test_provision_real_argon2_normalized_active_instructor(database, monkeypatch, capsys):
    assert provision(database, monkeypatch) == 0
    output = capsys.readouterr().out.strip()
    instructor_id = UUID(output)
    with Session(database.engine) as db:
        user = db.get(User, instructor_id)
        assert user.email == "new-instructor@example.com"
        assert user.role == "instructor" and user.is_active
        is_argon2id = user.password_hash.startswith("$argon2id$")
        verified = verify_password(database.password, user.password_hash)
        assert is_argon2id and verified
        assert db.scalar(select(text("count(*)")).select_from(User)) == 3
    preserved_baseline(database)
    after = snapshot(database.engine)
    assert all(after[table] == database.baseline[table] for table in TABLES if table != "users")


@pytest.mark.parametrize("email", ["existing-owner@example.com", "existing-student@example.com"])
def test_duplicate_never_changes_or_promotes_account(database, monkeypatch, email):
    before = snapshot(database.engine)
    assert provision(database, monkeypatch, email) == 1
    assert snapshot(database.engine) == before


def test_provision_failure_after_real_service_commit_rolls_back(database, monkeypatch):
    original = provisioner.register_user

    def after_commit(*args, **kwargs):
        original(*args, **kwargs)  # Real commit and refresh within a savepoint.
        raise RuntimeError("Injected failure after service commit")

    monkeypatch.setattr(provisioner, "register_user", after_commit)
    before = snapshot(database.engine)
    assert provision(database, monkeypatch) == 1
    assert snapshot(database.engine) == before


def test_provision_physical_root_commit_boundary_rolls_back(database, monkeypatch):
    before = snapshot(database.engine)
    reached = []

    def before_commit(connection):
        if connection.engine.url.database == database.url.database:
            reached.append(True)
            raise RuntimeError("Injected pre-physical-commit failure")

    event.listen(Engine, "commit", before_commit)
    try:
        assert provision(database, monkeypatch) == 1
    finally:
        event.remove(Engine, "commit", before_commit)
    assert reached == [True]
    assert snapshot(database.engine) == before


def test_dry_run_real_transaction_is_read_only(database, monkeypatch, capsys):
    before = snapshot(database.engine)
    assert import_courses(database, apply=False) == 0
    assert "would_create=8, skipped=0" in capsys.readouterr().out
    assert snapshot(database.engine) == before
    original = seed.seed_courses
    rejected = []

    def attempt_write(db, *args, **kwargs):
        original(db, *args, **kwargs)
        assert db.execute(text("SHOW transaction_read_only")).scalar_one() == "on"
        try:
            db.execute(text("UPDATE users SET full_name = full_name"))
        except DBAPIError as error:
            rejected.append(getattr(error.orig, "sqlstate", None))
            raise

    monkeypatch.setattr(seed, "seed_courses", attempt_write)
    assert import_courses(database, apply=False) == 1
    assert rejected == ["25006"]
    assert snapshot(database.engine) == before


def test_apply_exact_public_curriculum_repeat_idempotent_and_preserves_baseline(
    database, monkeypatch, capsys
):
    assert provision(database, monkeypatch) == 0
    database.owner = UUID(capsys.readouterr().out.strip())
    before_import = snapshot(database.engine)
    assert import_courses(database, apply=True) == 0
    assert "created=8, skipped=0" in capsys.readouterr().out
    manifest = seed.load_manifest()
    with Session(database.engine) as db:
        courses = list(
            db.scalars(
                select(Course).where(Course.slug.in_([course.slug for course in manifest.courses]))
            )
        )
        assert len(courses) == 8
        assert all(course.status == "published" and course.published_at for course in courses)
        assert all(course.instructor_id == database.owner for course in courses)
        modules = list(
            db.scalars(
                select(Module).where(Module.course_id.in_([course.id for course in courses]))
            )
        )
        lessons = list(
            db.scalars(
                select(Lesson).where(Lesson.module_id.in_([module.id for module in modules]))
            )
        )
        assert len(modules) == 21 and len(lessons) == 63
        assert all(lesson.video_url is None and lesson.content.strip() for lesson in lessons)
        catalog = repository.list_courses(db, public=True, page=1, page_size=100)
        assert catalog["total"] == 9  # Eight imported plus the existing published course.
        for course in courses:
            detail = service.public_course(db, course.slug).model_dump()
            for module in detail["modules"]:
                for lesson in module["lessons"]:
                    assert "content" not in lesson and "video_url" not in lesson
    preserved_baseline(database)
    first = snapshot(database.engine)
    assert all(
        first[table] == before_import[table]
        for table in ("users", "refresh_sessions", "enrollments", "lesson_progress")
    )
    assert import_courses(database, apply=True) == 0
    assert "created=0, skipped=8" in capsys.readouterr().out
    assert snapshot(database.engine) == first


def test_conflict_refuses_without_overwriting_any_rows(database):
    with Session(database.engine) as db:
        db.add(
            Course(
                instructor_id=database.owner,
                title="Unrelated conflicting title",
                slug=seed.load_manifest().courses[0].slug,
            )
        )
        db.commit()
    before = snapshot(database.engine)
    assert import_courses(database, apply=True) == 1
    assert snapshot(database.engine) == before
    preserved_baseline(database)


def test_late_failure_after_real_publication_commits_rolls_back_entire_import(
    database,
    monkeypatch,
    capsys,
):
    original = seed.set_publication
    completed = []

    def fail_third(*args, **kwargs):
        result = original(*args, **kwargs)  # Real publication commit/savepoint release.
        completed.append(True)
        if len(completed) == 3:
            raise RuntimeError("Injected after third real publication commit")
        return result

    monkeypatch.setattr(seed, "set_publication", fail_third)
    before = snapshot(database.engine)
    assert import_courses(database, apply=True) == 1
    assert len(completed) == 3
    assert "Created and published" not in capsys.readouterr().out
    assert snapshot(database.engine) == before
