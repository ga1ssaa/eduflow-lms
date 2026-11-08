import json
import os
import subprocess
from importlib import import_module
from pathlib import Path
from unittest.mock import Mock

import pytest
from click.testing import CliRunner
from uvicorn import Config


@pytest.mark.parametrize("port", [None, "18421"])
def test_container_command_respects_runtime_port_without_changing_default(tmp_path, port):
    dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile"
    command = json.loads(dockerfile.read_text().splitlines()[-1].removeprefix("CMD "))
    executable = tmp_path / "uvicorn"
    executable.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
    executable.chmod(0o700)
    env = {**os.environ, "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}"}
    env.pop("PORT", None)
    if port:
        env["PORT"] = port
    result = subprocess.run(command, env=env, capture_output=True, text=True, check=True)
    assert result.stdout.splitlines() == [
        "app.main:create_app",
        "--factory",
        "--host",
        "0.0.0.0",
        "--port",
        port or "8000",
    ]


def test_render_process_environment_bounds_workers_and_request_concurrency(monkeypatch):
    uvicorn_main = import_module("uvicorn.main")
    configs = []

    def capture_config(app, **kwargs):
        configs.append(
            Config(
                app,
                workers=kwargs["workers"],
                limit_concurrency=kwargs["limit_concurrency"],
                port=kwargs["port"],
                log_config=None,
            )
        )

    run = Mock(side_effect=capture_config)
    monkeypatch.setattr(uvicorn_main, "run", run)
    result = CliRunner().invoke(
        uvicorn_main.main,
        ["app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "10000"],
        env={"WEB_CONCURRENCY": "1", "UVICORN_LIMIT_CONCURRENCY": "4"},
    )
    assert result.exit_code == 0, result.output
    assert len(configs) == 1
    assert configs[0].workers == 1
    assert configs[0].limit_concurrency == 4
    assert configs[0].port == 10000
