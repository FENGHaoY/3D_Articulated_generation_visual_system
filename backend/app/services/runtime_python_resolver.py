from __future__ import annotations

from pathlib import Path


def resolve_singapo_python(singapo_conda_env: str, fallback_python: str) -> str:
    env_name = singapo_conda_env.strip()
    if env_name:
        # Common conda env location in this deployment.
        candidate = Path("/opt/conda/envs") / env_name / "bin" / "python"
        if candidate.exists():
            return str(candidate)
    return fallback_python
