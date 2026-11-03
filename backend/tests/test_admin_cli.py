import getpass
import secrets
import warnings
from unittest.mock import MagicMock

import pytest

from app import cli


@pytest.fixture
def cli_input(monkeypatch):
    monkeypatch.setattr(
        "sys.argv",
        ["eduflow", "create-admin", "--email", "admin@example.com", "--full-name", "Test Admin"],
    )
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    password = "Ab1!" + secrets.token_urlsafe(24)
    prompt = MagicMock(side_effect=[password, password])
    monkeypatch.setattr(cli.getpass, "getpass", prompt)
    session = MagicMock()
    monkeypatch.setattr(cli, "get_session_factory", lambda: lambda: session)
    register = MagicMock()
    monkeypatch.setattr(cli, "register_user", register)
    return password, prompt, register


def test_admin_cli_uses_hidden_confirmation_and_explicit_admin_role(cli_input, capsys):
    password, prompt, register = cli_input
    assert cli.main() == 0
    assert prompt.call_count == 2
    assert register.call_args.kwargs == {"role": "admin"}
    payload = register.call_args.args[1]
    assert payload.email == "admin@example.com"
    output = capsys.readouterr()
    assert password not in output.out + output.err


def test_admin_cli_duplicate_never_promotes_existing_user(cli_input, capsys):
    password, _, register = cli_input
    register.side_effect = cli.EmailAlreadyRegistered
    assert cli.main() == 1
    assert register.call_count == 1
    output = capsys.readouterr()
    assert "never promoted" in output.err
    assert password not in output.out + output.err


def test_admin_cli_refuses_noninteractive_password(cli_input, monkeypatch):
    _, prompt, register = cli_input
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    assert cli.main() == 1
    prompt.assert_not_called()
    register.assert_not_called()


def test_admin_cli_refuses_echo_fallback(cli_input, monkeypatch):
    _, _, register = cli_input

    def unsafe_prompt(_):
        warnings.warn("Hidden input unavailable", getpass.GetPassWarning, stacklevel=1)
        pytest.fail("The unsafe password prompt must never continue")

    monkeypatch.setattr(cli.getpass, "getpass", unsafe_prompt)
    assert cli.main() == 1
    register.assert_not_called()


def test_admin_cli_mismatched_confirmation_does_not_write(cli_input):
    _, prompt, register = cli_input
    prompt.side_effect = [secrets.token_urlsafe(24), secrets.token_urlsafe(24)]
    assert cli.main() == 1
    register.assert_not_called()
