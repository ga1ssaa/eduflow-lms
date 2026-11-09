"""Database-free production provisioning checks; transaction doubles are not PG proof."""

import getpass
import os
import secrets
import warnings
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app import provision_production_instructor as provision
from app.auth import repository, service
from app.auth.models import User
from app.auth.security import verify_password
from app.core.config import Settings
from app.import_demo_courses import _ROUTING_ENV

HOST = "ep-unit.eu-central-1.aws.neon.tech"
DATABASE = "neondb"


@pytest.fixture(autouse=True)
def forbid_database_connections(monkeypatch):
    forbidden = Mock(side_effect=AssertionError("Provisioning tests must never connect"))
    monkeypatch.setattr(provision, "create_engine", forbidden)
    monkeypatch.setattr("sqlalchemy.engine.Engine.connect", forbidden)
    monkeypatch.setattr("psycopg.connect", forbidden)
    for key in tuple(os.environ):
        if key.upper() in _ROUTING_ENV:
            monkeypatch.delenv(key)


@pytest.fixture
def state(monkeypatch, capsys):
    url = URL.create(
        "postgresql+psycopg",
        username="existing",
        password=secrets.token_urlsafe(24),
        host=HOST,
        database=DATABASE,
        query={"sslmode": "require", "channel_binding": "require"},
    )
    settings = Settings(
        _env_file=None,
        database_url=url.render_as_string(hide_password=False),
        jwt_secret=secrets.token_urlsafe(48),
        environment="production",
        refresh_cookie_secure=True,
        auth_allowed_origins=["https://frontend.example"],
        cors_origins=["https://frontend.example"],
    )
    password = "Ab1!" + secrets.token_urlsafe(24)
    state = SimpleNamespace(
        settings=settings,
        password=password,
        id=uuid4(),
        events=[],
        commit_error=None,
        identity=(DATABASE, "public", ["public"]),
        revisions=["0004_learning"],
        args=[
            "--email",
            " New.Instructor@Example.COM ",
            "--full-name",
            " New Instructor ",
            "--expected-host",
            HOST,
            "--expected-database",
            DATABASE,
            "--confirm-production-provisioning",
            provision.CONFIRMATION,
        ],
    )
    state.get_settings = Mock(side_effect=lambda: state.settings)
    monkeypatch.setattr(provision, "get_settings", state.get_settings)
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    state.prompt = Mock(side_effect=[password, password])
    monkeypatch.setattr(provision.getpass, "getpass", state.prompt)
    state.session = MagicMock()
    state.session.__enter__.return_value = state.session
    state.session.__exit__.return_value = False
    state.session.commit.side_effect = lambda: state.events.append("savepoint-commit")

    def refresh(user):
        state.events.append("refresh")
        user.id = state.id

    state.session.refresh.side_effect = refresh

    class Transaction:
        def __enter__(self):
            state.events.append("root-begin")
            return self

        def __exit__(self, kind, *_):
            # UUID output must not precede a confirmed root commit.
            assert not capsys.readouterr().out
            if kind:
                state.events.append("root-rollback")
            elif state.commit_error:
                raise state.commit_error
            else:
                state.events.append("root-commit")

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            state.events.append("connection-close")

        def begin(self):
            return Transaction()

        def execute(self, statement):
            state.events.append(str(statement))
            return SimpleNamespace(one=lambda: state.identity, scalars=lambda: state.revisions)

    connection = Connection()
    state.engine = SimpleNamespace(
        connect=Mock(return_value=connection),
        dispose=Mock(),
    )
    state.engine_factory = Mock(return_value=state.engine)
    monkeypatch.setattr(provision, "create_engine", state.engine_factory)
    state.sessions = Mock(return_value=state.session)
    monkeypatch.setattr(provision, "Session", state.sessions)
    state.register = Mock(return_value=SimpleNamespace(id=state.id))
    monkeypatch.setattr(provision, "register_user", state.register)
    state.connection = connection
    return state


@pytest.mark.parametrize("missing", [True, False])
def test_confirmation_is_required_before_settings_or_password(state, missing, capsys):
    if missing:
        state.args = state.args[:-2]
    else:
        state.args[-1] = state.password
    with pytest.raises(SystemExit) as rejected:
        provision.main(state.args)
    assert rejected.value.code == 2
    state.get_settings.assert_not_called()
    state.prompt.assert_not_called()
    state.engine_factory.assert_not_called()
    assert state.password not in capsys.readouterr().err


@pytest.mark.parametrize("change", ["development", "test", "host", "database", "pooler", "tls"])
def test_target_guards_run_before_password_or_engine(state, change, capsys):
    if change in {"development", "test"}:
        state.settings = state.settings.model_copy(update={"environment": change})
    elif change == "host":
        state.args[state.args.index("--expected-host") + 1] = "unexpected.example"
    elif change == "database":
        state.args[state.args.index("--expected-database") + 1] = "unexpected"
    else:
        url = URL.create(
            "postgresql+psycopg",
            username="existing",
            password=state.password,
            host=HOST if change == "tls" else HOST.replace("ep-unit", "ep-unit-pooler"),
            database=DATABASE,
            query={"sslmode": "prefer"},
        )
        state.settings = state.settings.model_copy(
            update={"database_url": url.render_as_string(hide_password=False)}
        )
    assert provision.main(state.args) == 1
    state.prompt.assert_not_called()
    state.engine_factory.assert_not_called()
    assert state.password not in capsys.readouterr().err


def test_configuration_error_is_sanitized_before_prompt(state, capsys):
    state.get_settings.side_effect = ValueError(state.password)
    assert provision.main(state.args) == 1
    state.prompt.assert_not_called()
    state.engine_factory.assert_not_called()
    assert state.password not in capsys.readouterr().err


def test_noninteractive_input_refuses_before_prompt_or_engine(state, monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    assert provision.main(state.args) == 1
    state.prompt.assert_not_called()
    state.engine_factory.assert_not_called()


@pytest.mark.parametrize("failure", [getpass.GetPassWarning, EOFError, KeyboardInterrupt])
def test_cancelled_or_unavailable_hidden_prompt_never_opens_engine(state, failure):
    state.prompt.side_effect = failure
    assert provision.main(state.args) == 1
    state.engine_factory.assert_not_called()


def test_warning_cannot_fall_back_to_echoing_password(state):
    def unsafe_prompt(_):
        warnings.warn("Hidden input unavailable", getpass.GetPassWarning, stacklevel=1)
        pytest.fail("Echo fallback must never continue")

    state.prompt.side_effect = unsafe_prompt
    assert provision.main(state.args) == 1
    state.engine_factory.assert_not_called()


def test_confirmation_mismatch_never_opens_engine(state):
    state.prompt.side_effect = [state.password, secrets.token_urlsafe(24)]
    assert provision.main(state.args) == 1
    state.engine_factory.assert_not_called()


@pytest.mark.parametrize("password", ["short1!", "a" * 12, "1" * 12, "A1" * 65])
def test_existing_password_validation_runs_before_engine(state, password, capsys):
    state.prompt.side_effect = [password, password]
    assert provision.main(state.args) == 1
    state.engine_factory.assert_not_called()
    assert password not in capsys.readouterr().err


@pytest.mark.parametrize(
    "flag,value", [("--email", "invalid"), ("--full-name", ""), ("--full-name", "Invalid\nName")]
)
def test_identity_validation_runs_before_engine(state, flag, value):
    state.args[state.args.index(flag) + 1] = value
    assert provision.main(state.args) == 1
    state.engine_factory.assert_not_called()


def test_success_outputs_only_uuid_after_root_commit(state, capsys):
    assert provision.main(state.args) == 0
    assert capsys.readouterr().out == f"{state.id}\n"
    assert "root-commit" in state.events
    state.sessions.assert_called_once_with(
        bind=state.connection, join_transaction_mode="create_savepoint"
    )
    state.register.assert_called_once()
    assert state.register.call_args.kwargs == {"role": "instructor"}
    payload = state.register.call_args.args[1]
    assert payload.email == "new.instructor@example.com" and payload.full_name == "New Instructor"
    state.engine.dispose.assert_called_once()


def test_real_service_hashes_argon2id_with_explicit_instructor_role(state, monkeypatch, capsys):
    monkeypatch.setattr(provision, "register_user", service.register_user)
    monkeypatch.setattr(repository, "user_by_email", Mock(return_value=None))
    assert provision.main(state.args) == 0
    user = state.session.add.call_args.args[0]
    assert user.role == "instructor" and user.password_hash.startswith("$argon2id$")
    assert verify_password(state.password, user.password_hash)
    assert state.events.index("refresh") < state.events.index("root-commit")
    output = capsys.readouterr()
    assert output.out == f"{state.id}\n"
    assert state.password not in output.out + output.err
    assert user.password_hash not in output.out + output.err


def test_duplicate_existing_account_is_never_promoted_rehashed_or_modified(state, monkeypatch):
    existing = User(
        id=uuid4(),
        email="new.instructor@example.com",
        full_name="Existing Learner",
        role="student",
        password_hash="existing-digest",
        is_active=True,
    )
    before = (existing.id, existing.full_name, existing.role, existing.password_hash)
    monkeypatch.setattr(provision, "register_user", service.register_user)
    monkeypatch.setattr(repository, "user_by_email", lambda *_: existing)
    hasher = Mock(side_effect=AssertionError("Duplicate account must not be rehashed"))
    monkeypatch.setattr(service, "hash_password", hasher)
    assert provision.main(state.args) == 1
    assert before == (existing.id, existing.full_name, existing.role, existing.password_hash)
    state.session.add.assert_not_called()
    state.session.commit.assert_not_called()
    hasher.assert_not_called()
    assert "root-rollback" in state.events


def test_concurrent_unique_email_failure_refuses_without_promotion(state, monkeypatch, capsys):
    existing = User(id=uuid4(), role="student", password_hash="existing-digest")
    monkeypatch.setattr(provision, "register_user", service.register_user)
    monkeypatch.setattr(repository, "user_by_email", Mock(side_effect=[None, existing]))
    state.session.commit.side_effect = IntegrityError("insert", {}, Exception(state.password))
    assert provision.main(state.args) == 1
    state.session.rollback.assert_called_once()
    assert existing.role == "student" and existing.password_hash == "existing-digest"
    output = capsys.readouterr()
    assert "never promoted" in output.err and state.password not in output.err
    assert "root-rollback" in state.events and "root-commit" not in state.events


@pytest.mark.parametrize("failure", ["head", "database", "schema"])
def test_runtime_schema_checks_precede_registration(state, failure):
    if failure == "head":
        state.revisions = ["0003_courses"]
    elif failure == "database":
        state.identity = ("unexpected", "public", ["public"])
    else:
        state.identity = (DATABASE, "public", ["public", "unexpected"])
    assert provision.main(state.args) == 1
    state.sessions.assert_not_called()
    state.register.assert_not_called()
    assert "root-rollback" in state.events


@pytest.mark.parametrize("stage", ["connection", "refresh", "root-commit"])
def test_failure_never_prints_success_or_private_error_details(state, monkeypatch, capsys, stage):
    if stage == "connection":
        state.engine.connect.side_effect = SQLAlchemyError(state.password)
    elif stage == "refresh":
        monkeypatch.setattr(provision, "register_user", service.register_user)
        monkeypatch.setattr(repository, "user_by_email", Mock(return_value=None))
        state.session.refresh.side_effect = SQLAlchemyError(state.password)
    else:
        state.commit_error = SQLAlchemyError(state.password)
    assert provision.main(state.args) == 1
    output = capsys.readouterr()
    assert not output.out and state.password not in output.err
    assert "Verify account existence read-only before retrying" in output.err
    if stage == "refresh":
        assert "root-rollback" in state.events and "root-commit" not in state.events


def test_password_cannot_be_supplied_as_a_cli_argument(state, capsys):
    with pytest.raises(SystemExit) as rejected:
        provision.main(state.args + ["--password", state.password])
    assert rejected.value.code == 2
    state.prompt.assert_not_called()
    state.engine_factory.assert_not_called()
    assert state.password not in capsys.readouterr().err
