from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.services.runtime_python_resolver import resolve_singapo_python

MESH_EXTENSIONS = {".ply", ".obj", ".glb", ".gltf", ".stl"}
PREVIEW_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".html"}


@dataclass
class SingapoRunResult:
    task_result_dir: Path
    metadata_json_path: Path
    mesh_file_path: Path | None
    preview_asset_path: Path | None
    pred_graph_path: Path | None
    sample_object_json_paths: list[Path]
    run_log_path: Path
    task_run_log_path: Path


class SingapoRunError(RuntimeError):
    def __init__(self, message: str, log_path: Path) -> None:
        super().__init__(message)
        self.log_path = log_path


class SingapoRunner:
    """
    Thin adapter around the official SINGAPO demo inference entrypoint.
    This keeps SINGAPO core logic untouched and isolates system integration.
    """

    def __init__(
        self,
        project_root: Path,
        singapo_root: Path,
        gt_data_root: Path,
        outputs_dir: Path,
        logs_dir: Path,
        singapo_python: str,
        singapo_conda_env: str,
        openai_api_key: str,
        singapo_dino_local_first: bool,
    ) -> None:
        self.project_root = project_root
        self.singapo_root = singapo_root
        self.gt_data_root = gt_data_root
        self.outputs_dir = outputs_dir
        self.logs_dir = logs_dir
        self.singapo_python = singapo_python
        self.singapo_conda_env = singapo_conda_env.strip()
        self.openai_api_key = openai_api_key
        self.singapo_dino_local_first = singapo_dino_local_first
        self.resolved_python = resolve_singapo_python(
            singapo_conda_env=self.singapo_conda_env,
            fallback_python=self.singapo_python,
        )

    def run_demo_inference(
        self,
        task_id: str,
        img_path: Path,
        n_samples: int,
        n_denoise_steps: int,
        omega: float,
        use_example_graph: bool,
        pred_graph_override_path: Path | None = None,
        progress_callback: Callable[[int], None] | None = None,
    ) -> SingapoRunResult:
        task_result_dir = self.outputs_dir / task_id
        task_result_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

        cmd = self._build_demo_command(
            img_path=img_path,
            save_dir=task_result_dir,
            n_samples=n_samples,
            n_denoise_steps=n_denoise_steps,
            omega=omega,
            use_example_graph=use_example_graph,
            pred_graph_override_path=pred_graph_override_path,
        )

        child_env = os.environ.copy()
        # graph_pred/api.py initializes OpenAI client at import-time.
        # Set a default API key to avoid failing even when using --use_example_graph.
        child_env["OPENAI_API_KEY"] = self.openai_api_key or "sk-dummy"
        child_env["SINGAPO_DINO_LOCAL_FIRST"] = "1" if self.singapo_dino_local_first else "0"

        run_log_path = self.logs_dir / f"{task_id}.log"
        task_run_log_path = task_result_dir / "run.log"
        print(f"[task:{task_id}] Starting SINGAPO inference: {' '.join(cmd)}", flush=True)
        if progress_callback is not None:
            progress_callback(10)

        process = subprocess.Popen(
            cmd,
            cwd=str(self.singapo_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=child_env,
            bufsize=1,
        )

        assert process.stdout is not None
        with run_log_path.open("w", encoding="utf-8") as runtime_log_fp, task_run_log_path.open(
            "w", encoding="utf-8"
        ) as task_log_fp:
            for line in process.stdout:
                runtime_log_fp.write(line)
                task_log_fp.write(line)
                runtime_log_fp.flush()
                task_log_fp.flush()
                print(f"[task:{task_id}] {line.rstrip()}", flush=True)
                if progress_callback is not None:
                    lowered = line.lower()
                    if "extracting dino feature" in lowered:
                        progress_callback(20)
                    elif "saving the predicted graph" in lowered:
                        progress_callback(35)
                    elif "loading model from checkpoint" in lowered:
                        progress_callback(50)
                    elif "running inference" in lowered:
                        progress_callback(70)
                    elif "post-processing" in lowered:
                        progress_callback(85)
                    elif "retrieving part meshes" in lowered:
                        progress_callback(92)
            process.wait()

        print(
            f"[task:{task_id}] SINGAPO inference finished with exit_code={process.returncode}",
            flush=True,
        )
        if progress_callback is not None and process.returncode == 0:
            progress_callback(98)

        if process.returncode != 0:
            raise SingapoRunError(
                (
                    f"SINGAPO inference failed with exit code {process.returncode}. "
                    f"log={run_log_path}"
                ),
                log_path=run_log_path,
            )

        sample_object_json_paths = self._collect_sample_object_jsons(task_result_dir)
        self._validate_mesh_outputs(task_result_dir, sample_object_json_paths, run_log_path)
        pred_graph_path = task_result_dir / "pred_graph.json"
        pred_graph_path = pred_graph_path if pred_graph_path.exists() else None
        mesh_file_path = self._find_preferred_mesh_file(task_result_dir)
        preview_asset_path = self._find_preview_asset(task_result_dir)

        metadata_json_path = task_result_dir / "task_result_metadata.json"
        metadata_payload = {
            "task_id": task_id,
            "task_result_dir": str(task_result_dir),
            "input_image": str(img_path),
            "pred_graph_path": str(pred_graph_path) if pred_graph_path else None,
            "pred_graph_override_path": str(pred_graph_override_path)
            if pred_graph_override_path is not None
            else None,
            "mesh_file_path": str(mesh_file_path) if mesh_file_path else None,
            "preview_asset_path": str(preview_asset_path) if preview_asset_path else None,
            "sample_object_json_paths": [str(p) for p in sample_object_json_paths],
            "run_log_path": str(run_log_path),
        }
        metadata_json_path.write_text(
            json.dumps(metadata_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return SingapoRunResult(
            task_result_dir=task_result_dir,
            metadata_json_path=metadata_json_path,
            mesh_file_path=mesh_file_path,
            preview_asset_path=preview_asset_path,
            pred_graph_path=pred_graph_path,
            sample_object_json_paths=sample_object_json_paths,
            run_log_path=run_log_path,
            task_run_log_path=task_run_log_path,
        )

    def _build_demo_command(
        self,
        img_path: Path,
        save_dir: Path,
        n_samples: int,
        n_denoise_steps: int,
        omega: float,
        use_example_graph: bool,
        pred_graph_override_path: Path | None = None,
    ) -> list[str]:
        cmd: list[str] = [self.resolved_python]

        cmd.extend(
            [
                "demo/demo.py",
                "--img_path",
                str(img_path),
                "--save_dir",
                str(save_dir),
                "--gt_data_root",
                str(self.gt_data_root),
                "--n_samples",
                str(n_samples),
                "--n_denoise_steps",
                str(n_denoise_steps),
                "--omega",
                str(omega),
            ]
        )
        if pred_graph_override_path is not None:
            cmd.extend(["--pred_graph_path", str(pred_graph_override_path)])
        if use_example_graph:
            cmd.append("--use_example_graph")
        return cmd

    def _collect_sample_object_jsons(self, task_result_dir: Path) -> list[Path]:
        paths: list[Path] = []
        for child in sorted(task_result_dir.iterdir()):
            if child.is_dir():
                object_json = child / "object.json"
                if object_json.exists():
                    paths.append(object_json)
        return paths

    def _find_preferred_mesh_file(self, task_result_dir: Path) -> Path | None:
        object_plys = sorted(task_result_dir.glob("*/object.ply"))
        if object_plys:
            return object_plys[0]

        candidates: list[Path] = []
        for path in sorted(task_result_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in MESH_EXTENSIONS:
                candidates.append(path)
        return candidates[0] if candidates else None

    def _find_preview_asset(self, task_result_dir: Path) -> Path | None:
        preferred = task_result_dir / "pred_graph.png"
        if preferred.exists():
            return preferred

        candidates: list[Path] = []
        for path in sorted(task_result_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in PREVIEW_EXTENSIONS:
                candidates.append(path)
        return candidates[0] if candidates else None

    def _validate_mesh_outputs(
        self,
        task_result_dir: Path,
        sample_object_json_paths: list[Path],
        run_log_path: Path,
    ) -> None:
        if not sample_object_json_paths:
            raise SingapoRunError(
                f"No sample object.json generated under {task_result_dir}. log={run_log_path}",
                log_path=run_log_path,
            )

        missing_overall: list[str] = []
        missing_parts: list[str] = []
        for object_json in sample_object_json_paths:
            sample_dir = object_json.parent
            object_ply = sample_dir / "object.ply"
            part_plys = sorted((sample_dir / "plys").glob("part_*.ply"))
            if not object_ply.exists():
                missing_overall.append(str(object_ply))
            if not part_plys:
                missing_parts.append(str(sample_dir / "plys/part_*.ply"))

        if missing_overall or missing_parts:
            details = []
            if missing_overall:
                details.append(f"missing object.ply: {missing_overall[:3]}")
            if missing_parts:
                details.append(f"missing part plys: {missing_parts[:3]}")
            details_text = "; ".join(details)
            raise SingapoRunError(
                f"SINGAPO run finished but mesh retrieval outputs are incomplete ({details_text}). "
                f"log={run_log_path}",
                log_path=run_log_path,
            )
