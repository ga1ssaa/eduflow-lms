"""Instructor provisioning checks with mocked sessions; no database connections."""

import getpass
import secrets
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app import cli
from app.auth import repository, service
from app.auth.models import User
from app.auth.schemas import RegisterRequest
from app.auth.security import verify_password


@pytest.fixture
def instructor_input(monkeypatch):
    args = [
        "eduflow",
        "create-instructor",
        "--email",
        " New.Instructor@Example.COM ",
        "--full-name",
        " Development Instructor ",
    ]
    monkeypatch.setattr("sys.argv", args)
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    settings = MagicMock(return_value=SimpleNamespace(environment="development"))
    monkeypatch.setattr(cli, "get_settings", settings)
    password = "Ab1!" + secrets.token_urlsafe(24)
    prompt = MagicMock(side_effect=[password, password])
    monkeypatch.setattr(cli.getpass, "getpass", prompt)
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    factory = MagicMock(return_value=lambda: session)
    monkeypatch.setattr(cli, "get_session_factory", factory)
    user_id = uuid4()
    register = MagicMock(return_value=SimpleNamespace(id=user_id))
    monkeypatch.setattr(cli, "register_user", register)

    def no_engine(*_, **__):
        pytest.fail("Instructor CLI tests must never create a database engine")

    monkeypatch.setattr("app.db.session.create_engine", no_engine)
    return SimpleNamespace(
        args=args,
        settings=settings,
        password=password,
        prompt=prompt,
        session=session,
        factory=factory,
        register=register,
        user_id=user_id,
    )


@pytest.mark.parametrize("environment", ["production", "test", None, ""])
def test_non_development_is_rejected_before_prompt_or_session(
    instructor_input, environment, capsys
):
    state = instructor_input
    state.settings.return_value.environment = environment
    assert cli.main() == 1
    state.prompt.assert_not_called()
    state.factory.assert_not_called()
    state.register.assert_not_called()
    assert "requires ENVIRONMENT=development" in capsys.readouterr().err


def test_invalid_configuration_is_reported_without_secret_values(instructor_input, capsys):
    state = instructor_input
    state.settings.side_effect = ValidationError.from_exception_data(
        "Settings",
        [{"type": "missing", "loc": ("database_url",), "input": state.password}],
    )
    assert cli.main() == 1
    state.prompt.assert_not_called()
    state.factory.assert_not_called()
    output = capsys.readouterr()
    assert "Invalid backend configuration" in output.err
    assert state.password not in output.out + output.err


def test_development_uses_validated_email_and_explicit_new_instructor_role(
    instructor_input, capsys
):
    state = instructor_input
    assert cli.main() == 0
    assert state.prompt.call_count == 2
    state.register.assert_called_once()
    payload = state.register.call_args.args[1]
    assert payload.email == "new.instructor@example.com"
    assert payload.full_name == "Development Instructor"
    assert payload.password == state.password
    assert state.register.call_args.kwargs == {"role": "instructor"}
    output = capsys.readouterr()
    assert output.out == f"Instructor account created: {state.user_id}\n"
    assert not output.err
    assert state.password not in output.out
    assert str(payload.email) not in output.out


def test_real_registration_hashes_password_with_argon2id(instructor_input, monkeypatch, capsys):
    state = instructor_input
    monkeypatch.setattr(cli, "register_user", service.register_user)
    lookup = MagicMock(return_value=None)
    monkeypatch.setattr(repository, "user_by_email", lookup)
    state.session.refresh.side_effect = lambda user: setattr(user, "id", state.user_id)
    assert cli.main() == 0
    user = state.session.add.call_args.args[0]
    assert user.role == "instructor"
    assert user.password_hash.startswith("$argon2id$")
    assert user.password_hash != state.password
    assert verify_password(state.password, user.password_hash)
    assert not hasattr(user, "password")
    state.session.commit.assert_called_once()
    lookup.assert_called_once_with(state.session, "new.instructor@example.com")
    output = capsys.readouterr()
    assert str(state.user_id) in output.out
    assert state.password not in output.out + output.err
    assert user.password_hash not in output.out + output.err


def test_duplicate_never_promotes_modifies_or_rehashes_existing_user(
    instructor_input,
    monkeypatch,
    capsys,
):
    state = instructor_input
    existing = User(
        id=uuid4(),
        email="new.instructor@example.com",
        full_name="Existing Learner",
        role="student",
        password_hash="existing-digest",
        is_active=True,
    )
    before = (
        existing.id,
        existing.email,
        existing.full_name,
        existing.role,
        existing.password_hash,
    )
    monkeypatch.setattr(cli, "register_user", service.register_user)
    monkeypatch.setattr(repository, "user_by_email", lambda *_: existing)
    hasher = MagicMock(side_effect=AssertionError("Duplicate must not be rehashed"))
    monkeypatch.setattr(service, "hash_password", hasher)
    assert cli.main() == 1
    assert before == (
        existing.id,
        existing.email,
        existing.full_name,
        existing.role,
        existing.password_hash,
    )
    state.session.add.assert_not_called()
    state.session.commit.assert_not_called()
    state.session.refresh.assert_not_called()
    hasher.assert_not_called()
    output = capsys.readouterr()
    assert "never promoted" in output.err
    assert state.password not in output.out + output.err


def test_duplicate_insert_race_rolls_back_without_promoting(instructor_input, monkeypatch, capsys):
    state = instructor_input
    existing = User(id=uuid4(), role="student", password_hash="existing-digest")
    monkeypatch.setattr(cli, "register_user", service.register_user)
    monkeypatch.setattr(repository, "user_by_email", MagicMock(side_effect=[None, existing]))
    state.session.commit.side_effect = IntegrityError("insert", {}, Exception(state.password))
    assert cli.main() == 1
    state.session.rollback.assert_called_once()
    assert existing.role == "student" and existing.password_hash == "existing-digest"
    output = capsys.readouterr()
    assert "never promoted" in output.err
    assert state.password not in output.out + output.err


def test_database_failure_uses_a_safe_message(instructor_input, capsys):
    state = instructor_input
    state.register.side_effect = SQLAlchemyError("private details " + state.password)
    assert cli.main() == 1
    output = capsys.readouterr()
    assert "database unavailable or invalid schema" in output.err
    assert "private details" not in output.err
    assert state.password not in output.out + output.err


def test_refuses_noninteractive_password(instructor_input, monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    assert cli.main() == 1
    instructor_input.prompt.assert_not_called()
    instructor_input.factory.assert_not_called()


@pytest.mark.parametrize("failure", [getpass.GetPassWarning, EOFError, KeyboardInterrupt])
def test_cancelled_or_unsafe_prompt_never_opens_session(instructor_input, failure, capsys):
    state = instructor_input
    state.prompt.side_effect = failure
    assert cli.main() == 1
    state.factory.assert_not_called()
    state.register.assert_not_called()
    output = capsys.readouterr()
    assert state.password not in output.out + output.err


def test_confirmation_mismatch_never_opens_session(instructor_input, capsys):
    state = instructor_input
    state.prompt.side_effect = [state.password, secrets.token_urlsafe(24)]
    assert cli.main() == 1
    state.factory.assert_not_called()
    assert state.password not in capsys.readouterr().err


@pytest.mark.parametrize(
    "field,value",
    [
        ("--email", "not-an-email"),
        ("--full-name", ""),
        ("--full-name", "Invalid\nName"),
    ],
)
def test_existing_user_validation_applies(instructor_input, field, value, capsys):
    state = instructor_input
    state.args[state.args.index(field) + 1] = value
    assert cli.main() == 1
    state.factory.assert_not_called()
    output = capsys.readouterr()
    assert state.password not in output.out + output.err


def test_invalid_password_never_opens_session(instructor_input, capsys):
    state = instructor_input
    invalid = secrets.token_hex(3)
    state.prompt.side_effect = [invalid, invalid]
    assert cli.main() == 1
    state.factory.assert_not_called()
    output = capsys.readouterr()
    assert invalid not in output.out + output.err


@pytest.mark.parametrize("missing", ["--email", "--full-name"])
def test_identity_arguments_are_required(instructor_input, missing):
    state = instructor_input
    position = state.args.index(missing)
    del state.args[position : position + 2]
    with pytest.raises(SystemExit) as error:
        cli.main()
    assert error.value.code == 2
    state.prompt.assert_not_called()
    state.factory.assert_not_called()


def test_public_registration_keeps_student_default_and_forbids_role_input(
    instructor_input,
    monkeypatch,
):
    state = instructor_input
    payload = RegisterRequest(
        email="student@example.com",
        full_name="New Learner",
        password=state.password,
    )
    with pytest.raises(ValidationError):
        RegisterRequest.model_validate({**payload.model_dump(), "role": "instructor"})
    monkeypatch.setattr(repository, "user_by_email", lambda *_: None)
    user = service.register_user(state.session, payload)
    assert user.role == "student"
