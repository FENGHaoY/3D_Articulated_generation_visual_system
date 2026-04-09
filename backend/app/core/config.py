from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    project_root: Path
    singapo_root: Path
    runtime_root: Path
    uploads_dir: Path
    jobs_dir: Path
    results_dir: Path
    logs_dir: Path
    tasks_db_file: Path
    api_host: str
    api_port: int
    default_use_example_graph: bool
    singapo_python: str
    singapo_conda_env: str
    openai_api_key: str
    singapo_dino_local_first: bool


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_settings() -> Settings:
    project_root = Path(__file__).resolve().parents[3]

    singapo_root = Path(
        os.getenv("SINGAPO_ROOT", str(project_root / "singapo"))
    ).resolve()
    runtime_root = Path(
        os.getenv("RUNTIME_ROOT", str(project_root / "runtime"))
    ).resolve()

    uploads_dir = runtime_root / "uploads"
    jobs_dir = runtime_root / "jobs"
    results_dir = runtime_root / "results"
    logs_dir = runtime_root / "logs"

    return Settings(
        project_root=project_root,
        singapo_root=singapo_root,
        runtime_root=runtime_root,
        uploads_dir=uploads_dir,
        jobs_dir=jobs_dir,
        results_dir=results_dir,
        logs_dir=logs_dir,
        tasks_db_file=jobs_dir / "tasks.json",
        api_host=os.getenv("API_HOST", "0.0.0.0"),
        api_port=int(os.getenv("API_PORT", "8000")),
        default_use_example_graph=_bool_env("DEFAULT_USE_EXAMPLE_GRAPH", True),
        singapo_python=os.getenv("SINGAPO_PYTHON", "python"),
        singapo_conda_env=os.getenv("SINGAPO_CONDA_ENV", "singapo"),
        openai_api_key=os.getenv("OPENAI_API_KEY", "sk-dummy"),
        singapo_dino_local_first=_bool_env("SINGAPO_DINO_LOCAL_FIRST", True),
    )
