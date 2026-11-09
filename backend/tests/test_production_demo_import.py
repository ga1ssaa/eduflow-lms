"""Database-free importer guards and transaction doubles, not PostgreSQL atomicity proof."""

import os
import secrets
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError
from test_demo_seed import MemorySession

from app import import_demo_courses as importer
from app import seed_demo_courses as seed
from app.core.config import Settings
from app.courses import repository

HOST = "ep-unit.eu-central-1.aws.neon.tech"
DATABASE = "neondb"


@pytest.fixture(autouse=True)
def forbid_real_connections(monkeypatch):
    forbidden = Mock(side_effect=AssertionError("Production import tests must never connect"))
    monkeypatch.setattr(importer, "create_engine", forbidden)
    monkeypatch.setattr("sqlalchemy.engine.Engine.connect", forbidden)
    monkeypatch.setattr("psycopg.connect", forbidden)
    for key in tuple(os.environ):
        if key.upper() in importer._ROUTING_ENV:
            monkeypatch.delenv(key)


@pytest.fixture
def settings():
    url = URL.create(
        "postgresql+psycopg",
        username="existing",
        password=secrets.token_urlsafe(24),
        host=HOST,
        database=DATABASE,
        query={"sslmode": "require", "channel_binding": "require"},
    )
    return Settings(
        _env_file=None,
        database_url=url.render_as_string(hide_password=False),
        jwt_secret=secrets.token_urlsafe(48),
        environment="production",
        refresh_cookie_secure=True,
        auth_allowed_origins=["https://frontend.example"],
        cors_origins=["https://frontend.example"],
    )


def arguments(*, apply=False, instructor_id=None):
    result = [
        "--instructor-id",
        str(instructor_id or uuid4()),
        "--expected-host",
        HOST,
        "--expected-database",
        DATABASE,
        "--apply" if apply else "--dry-run",
    ]
    if apply:
        result += ["--confirm-production-import", importer.CONFIRMATION]
    return result


@pytest.mark.parametrize(
    "change",
    [
        "development",
        "host",
        "database",
        "pooler",
        "port",
        "password",
        "tls",
        "channel",
        "routing",
        "service",
        "options",
        "duplicate",
    ],
)
def test_target_refuses_mismatches_or_ambiguous_connections(settings, change):
    url = URL.create(
        "postgresql+psycopg",
        username="existing",
        password=secrets.token_urlsafe(24),
        host=HOST,
        database=DATABASE,
        query={"sslmode": "require", "channel_binding": "require"},
    )
    if change == "development":
        settings = settings.model_copy(update={"environment": "development"})
    elif change == "host":
        url = url.set(host="unexpected.example")
    elif change == "database":
        url = url.set(database="unexpected")
    elif change == "pooler":
        url = url.set(host="ep-unit-pooler.eu-central-1.aws.neon.tech")
    elif change == "port":
        url = url.set(port=6543)
    elif change == "password":
        url = URL.create(
            url.drivername, username="existing", host=HOST, database=DATABASE, query=url.query
        )
    elif change == "tls":
        url = url.update_query_dict({"sslmode": "prefer"})
    elif change == "channel":
        url = url.update_query_dict({"channel_binding": "prefer"})
    elif change == "routing":
        url = url.update_query_dict({"hostaddr": "192.0.2.1"})
    elif change == "service":
        url = url.update_query_dict({"service": "opaque"})
    elif change == "options":
        url = url.update_query_dict({"options": "-csearch_path=unexpected"})
    else:
        url = url.update_query_dict({"sslmode": ("require", "disable")})
    settings = settings.model_copy(
        update={"database_url": url.render_as_string(hide_password=False)}
    )
    with pytest.raises(importer.ImportRefused):
        importer._guard_target(settings, HOST, DATABASE)


@pytest.mark.parametrize(
    "name", ["PGHOSTADDR", "PGSERVICE", "PGPASSWORD", "PGPASSFILE", "PGOPTIONS"]
)
def test_libpq_defaults_cannot_retarget_import(settings, monkeypatch, name):
    monkeypatch.setenv(name, "untrusted-default")
    with pytest.raises(importer.ImportRefused, match="routing defaults"):
        importer._guard_target(settings, HOST, DATABASE)


def test_verify_full_is_accepted_without_channel_binding(settings):
    url = URL.create(
        "postgresql+psycopg",
        username="existing",
        password=secrets.token_urlsafe(24),
        host=HOST,
        database=DATABASE,
        query={"sslmode": "verify-full"},
    )
    settings = settings.model_copy(
        update={"database_url": url.render_as_string(hide_password=False)}
    )
    assert importer._guard_target(settings, HOST, DATABASE).database == DATABASE


@pytest.mark.parametrize(
    "change", ["no-mode", "both-modes", "no-confirmation", "wrong-confirmation"]
)
def test_apply_requires_explicit_mode_and_project_branch_attestation(monkeypatch, change, capsys):
    argv = arguments(apply=True)
    if change == "no-mode":
        argv.remove("--apply")
    elif change == "both-modes":
        argv.append("--dry-run")
    elif change == "no-confirmation":
        argv = argv[:-2]
    else:
        argv[-1] = "untrusted-value"
    lookup = Mock(side_effect=AssertionError("Arguments must be refused before settings"))
    monkeypatch.setattr(importer, "get_settings", lookup)
    with pytest.raises(SystemExit) as rejected:
        importer.main(argv)
    assert rejected.value.code == 2
    lookup.assert_not_called()
    assert "untrusted-value" not in capsys.readouterr().err


@pytest.fixture
def harness(settings, monkeypatch):
    events = []
    db = MemorySession()
    state = SimpleNamespace(
        db=db,
        events=events,
        revisions=["0004_learning"],
        identity=(DATABASE, "public", ["public"]),
        commit_error=None,
    )

    class Transaction:
        def __init__(self):
            self.before = deepcopy(db.courses)

        def __enter__(self):
            return self

        def __exit__(self, kind, *_):
            if kind:
                self.rollback()
            else:
                if state.commit_error is not None:
                    raise state.commit_error
                events.append("outer-commit")

        def rollback(self):
            events.append("outer-rollback")
            db.courses = self.before

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            events.append("connection-close")

        def begin(self):
            events.append("outer-begin")
            return Transaction()

        def exec_driver_sql(self, sql):
            events.append(sql)

        def execute(self, statement):
            sql = str(statement)
            events.append(sql)
            return SimpleNamespace(one=lambda: state.identity, scalars=lambda: state.revisions)

    connection = Connection()
    engine = SimpleNamespace(connect=lambda: connection, dispose=lambda: events.append("dispose"))
    monkeypatch.setattr(importer, "get_settings", lambda: settings)
    engine_factory = Mock(return_value=engine)
    monkeypatch.setattr(importer, "create_engine", engine_factory)

    def session_factory(**kwargs):
        assert kwargs == {"bind": connection, "join_transaction_mode": "create_savepoint"}
        events.append("session-open")
        return db

    session_factory = Mock(side_effect=session_factory)
    monkeypatch.setattr(importer, "Session", session_factory)
    monkeypatch.setattr(repository, "course_by_id", lambda db, id, **_: db.lookup(id))
    monkeypatch.setattr(repository, "modules_for_course", lambda db, id: db.lookup(id).modules)
    monkeypatch.setattr(repository, "lessons_for_course", lambda db, id: db.lessons(id))

    def detail(db, id):
        course = db.lookup(id)
        fields = (
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
        return {
            **{key: getattr(course, key) for key in fields},
            "instructor_name": db.user.full_name,
            "module_count": len(course.modules),
            "lesson_count": len(db.lessons(id)),
            "modules": course.modules,
        }

    monkeypatch.setattr(repository, "course_detail", detail)
    state.factory, state.sessions = engine_factory, session_factory
    return state


def test_dry_run_sets_read_only_before_any_reads_and_never_commits(harness, capsys):
    assert importer.main(arguments(instructor_id=harness.db.user.id)) == 0
    assert harness.events[:2] == ["outer-begin", "SET TRANSACTION READ ONLY"]
    assert harness.events.index("session-open") > 2
    assert "outer-rollback" in harness.events and "outer-commit" not in harness.events
    assert harness.db.commits == harness.db.flushes == 0 and not harness.db.courses
    assert "would_create=8" in capsys.readouterr().out


def test_apply_reuses_real_manifest_publication_and_skips_exact_repeats(harness, capsys):
    user_before = (harness.db.user.id, harness.db.user.role, harness.db.user.is_active)
    argv = arguments(apply=True, instructor_id=harness.db.user.id)
    assert importer.main(argv) == 0
    output = capsys.readouterr()
    assert "created=8, skipped=0" in output.out and "Created and published" not in output.out
    assert harness.events.count("outer-commit") == 1 and harness.db.commits == 8
    before = {id: seed._fingerprint(course) for id, course in harness.db.courses.items()}
    assert len(before) == 8
    assert sum(len(course.modules) for course in harness.db.courses.values()) == 21
    assert sum(len(harness.db.lessons(id)) for id in before) == 63
    assert importer.main(argv) == 0
    assert "created=0, skipped=8" in capsys.readouterr().out
    assert before == {id: seed._fingerprint(course) for id, course in harness.db.courses.items()}
    assert user_before == (harness.db.user.id, harness.db.user.role, harness.db.user.is_active)


@pytest.mark.parametrize("failure", ["revision", "database", "schema"])
def test_schema_or_runtime_target_mismatch_refuses_before_session(harness, failure, capsys):
    if failure == "revision":
        harness.revisions = ["0003_courses"]
    elif failure == "database":
        harness.identity = ("unexpected", "public", ["public"])
    else:
        harness.identity = (DATABASE, "public", ["public", "unexpected"])
    assert importer.main(arguments(apply=True, instructor_id=harness.db.user.id)) == 1
    harness.sessions.assert_not_called()
    assert "outer-rollback" in harness.events and "outer-commit" not in harness.events
    assert "refused" in capsys.readouterr().err


def test_late_publication_failure_rolls_back_all_and_hides_partial_success(
    harness, monkeypatch, capsys
):
    original = seed.set_publication
    calls = 0
    sensitive = secrets.token_urlsafe(24)

    def publish(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise SQLAlchemyError(sensitive)
        return original(*args, **kwargs)

    monkeypatch.setattr(seed, "set_publication", publish)
    assert importer.main(arguments(apply=True, instructor_id=harness.db.user.id)) == 1
    assert calls == 3 and harness.db.commits == 2 and not harness.db.courses
    assert "outer-rollback" in harness.events and "outer-commit" not in harness.events
    output = capsys.readouterr()
    assert not output.out and sensitive not in output.err


def test_conflicts_are_visible_and_never_overwritten(harness, capsys):
    course = seed.build_course(seed.load_manifest().courses[0], harness.db.user.id)
    course.title = "Existing edited title"
    harness.db.courses[course.id] = course
    before = seed._fingerprint(course)
    assert importer.main(arguments(apply=True, instructor_id=harness.db.user.id)) == 1
    output = capsys.readouterr()
    assert course.slug in output.err and not output.out
    assert seed._fingerprint(harness.db.courses[course.id]) == before
    assert harness.db.commits == 0 and len(harness.db.courses) == 1


@pytest.mark.parametrize("stage", ["configuration", "connection"])
def test_private_configuration_and_connection_errors_are_sanitized(
    harness, monkeypatch, capsys, stage
):
    sensitive = secrets.token_urlsafe(24)
    if stage == "configuration":
        monkeypatch.setattr(importer, "get_settings", Mock(side_effect=ValueError(sensitive)))
    else:
        harness.factory.return_value.connect = Mock(side_effect=SQLAlchemyError(sensitive))
    assert importer.main(arguments(apply=True, instructor_id=harness.db.user.id)) == 1
    output = capsys.readouterr()
    assert not output.out and sensitive not in output.err
    assert "read-only dry run before retrying" in output.err
    assert harness.db.commits == 0


def test_outer_commit_failure_never_reports_success_or_assumes_rollback(harness, capsys):
    sensitive = secrets.token_urlsafe(24)
    harness.commit_error = SQLAlchemyError(sensitive)
    assert importer.main(arguments(apply=True, instructor_id=harness.db.user.id)) == 1
    assert harness.db.commits == 8  # Simulated inner savepoint releases, not a root commit.
    output = capsys.readouterr()
    assert not output.out and sensitive not in output.err
    assert "read-only dry run before retrying" in output.err
    assert "nothing changed" not in output.err and "rolled back" not in output.err


@pytest.mark.parametrize("role,active", [("admin", True), ("student", True), ("instructor", False)])
def test_import_never_creates_or_changes_accounts(harness, role, active, capsys):
    harness.db.user.role, harness.db.user.is_active = role, active
    assert importer.main(arguments(apply=True, instructor_id=harness.db.user.id)) == 1
    assert harness.db.user.role == role and harness.db.user.is_active == active
    assert not harness.db.courses and harness.db.commits == 0
    assert "active instructor" in capsys.readouterr().err
