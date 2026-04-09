from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.services.runtime_python_resolver import resolve_singapo_python


class EnvCheckService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def run(self) -> dict[str, Any]:
        checks: list[dict[str, Any]] = []
        resolved_python = resolve_singapo_python(
            singapo_conda_env=self.settings.singapo_conda_env,
            fallback_python=self.settings.singapo_python,
        )

        checks.append(self._check_path_exists("singapo_root_exists", self.settings.singapo_root))
        checks.append(
            self._check_path_exists(
                "demo_entry_exists", self.settings.singapo_root / "demo" / "demo.py"
            )
        )
        checks.append(
            self._check_path_exists(
                "ckpt_exists",
                self.settings.singapo_root / "exps" / "singapo" / "final" / "ckpts" / "last.ckpt",
            )
        )
        checks.append(
            self._check_path_exists(
                "config_exists",
                self.settings.singapo_root
                / "exps"
                / "singapo"
                / "final"
                / "config"
                / "parsed.yaml",
            )
        )

        conda_path = shutil.which("conda")
        checks.append(
            {
                "name": "conda_available",
                "ok": conda_path is not None,
                "detail": conda_path or "conda command not found",
            }
        )
        checks.extend(self._check_python_fallback_runtime(resolved_python, label="resolved_python"))

        overall_ok = all(item["ok"] for item in checks)
        return {
            "ok": overall_ok,
            "mode": "resolved_python",
            "singapo_conda_env": self.settings.singapo_conda_env,
            "singapo_python": self.settings.singapo_python,
            "resolved_python": resolved_python,
            "checks": checks,
        }

    def _check_path_exists(self, name: str, path: Path) -> dict[str, Any]:
        return {"name": name, "ok": path.exists(), "detail": str(path)}

    def _check_python_fallback_runtime(self, python_exec: str, label: str) -> list[dict[str, Any]]:
        checks: list[dict[str, Any]] = []
        checks.append(
            self._run_cmd_check(
                f"{label}_exists",
                [python_exec, "-c", "import sys; print(sys.executable)"],
            )
        )
        checks.append(
            self._run_cmd_check(
                f"{label}_torch",
                [python_exec, "-c", "import torch; print(torch.__version__)"],
            )
        )
        checks.append(
            self._run_cmd_check(
                f"{label}_demo_imports",
                [python_exec, "-c", "import numpy, PIL, torchvision, diffusers; print('ok')"],
            )
        )
        checks.append(
            self._run_cmd_check(
                f"{label}_trimesh",
                [python_exec, "-c", "import trimesh; print(trimesh.__version__)"],
            )
        )
        return checks

    def _run_cmd_check(self, name: str, cmd: list[str]) -> dict[str, Any]:
        proc = subprocess.run(
            cmd,
            cwd=str(self.settings.singapo_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )
        output = (proc.stdout or "").strip()
        return {
            "name": name,
            "ok": proc.returncode == 0,
            "detail": output[-800:] if output else "",
            "command": cmd,
        }
