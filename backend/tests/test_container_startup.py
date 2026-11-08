import json
import os
import subprocess
from pathlib import Path

import pytest


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
