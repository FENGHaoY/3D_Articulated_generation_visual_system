from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.models.task_schema import TaskRecord
from app.services.static_url_service import StaticUrlService


MESH_EXTENSIONS = {".ply", ".obj", ".glb", ".gltf", ".stl"}
PREVIEW_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".html"}


class ResultOrganizer:
    """
    Normalize SINGAPO raw outputs into a stable frontend-facing manifest.
    """

    def __init__(self, uploads_dir: Path, results_dir: Path) -> None:
        self.uploads_dir = uploads_dir
        self.results_dir = results_dir
        self.url_service = StaticUrlService(uploads_dir=uploads_dir, results_dir=results_dir)

    def build_and_write(self, task: TaskRecord) -> dict[str, Any]:
        task_output_dir = Path(task.output_dir)
        task_output_dir.mkdir(parents=True, exist_ok=True)

        mesh_files = self._collect_files(task_output_dir, MESH_EXTENSIONS)
        preview_files = self._collect_files(task_output_dir, PREVIEW_EXTENSIONS)
        object_json_files = self._collect_named_files(task_output_dir, "object.json")

        joints_file = self._find_optional_json(task_output_dir, "joints.json")
        parts_file = self._find_optional_json(task_output_dir, "parts.json")

        manifest: dict[str, Any] = {
            "task_id": task.task_id,
            "status": task.status,
            "input_image": self._input_file_item(Path(task.input_path)),
            "mesh_files": mesh_files,
            "preview_files": preview_files,
            "object_json_files": object_json_files,
            "joints_file": joints_file,
            "parts_file": parts_file,
            "raw_output_dir": self.url_service.to_result_url(task_output_dir),
            "raw_output_dir_path": str(task_output_dir),
            "created_at": task.created_at.isoformat(),
            "finished_at": task.updated_at.isoformat()
            if task.status in {"succeeded", "failed"}
            else None,
            "error": task.error,
        }

        meta = {
            "task_id": task.task_id,
            "status": task.status,
            "counts": {
                "mesh_files": len(mesh_files),
                "preview_files": len(preview_files),
            },
            "notes": "joints_file and parts_file are reserved fields; may be null in current MVP.",
        }

        meta_path = task_output_dir / "meta.json"
        manifest_path = task_output_dir / "result_manifest.json"
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        manifest["meta_url"] = self.url_service.to_result_url(meta_path)
        manifest["manifest_url"] = self.url_service.to_result_url(manifest_path)
        return manifest

    def _collect_files(self, root: Path, extensions: set[str]) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix.lower() in extensions:
                item = self._result_file_item(path)
                if item is not None:
                    out.append(item)
        return out

    def _find_optional_json(self, root: Path, name: str) -> dict[str, str] | None:
        for path in sorted(root.rglob(name)):
            if path.is_file():
                return self._result_file_item(path)
        return None

    def _collect_named_files(self, root: Path, name: str) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        for path in sorted(root.rglob(name)):
            if path.is_file():
                item = self._result_file_item(path)
                if item is not None:
                    out.append(item)
        return out

    def _result_file_item(self, path: Path) -> dict[str, str] | None:
        url = self.url_service.to_result_url(path)
        if url is None:
            return None
        relative = path.relative_to(self.results_dir).as_posix()
        return {
            "path": str(path),
            "relative_path": relative,
            "url": url,
        }

    def _input_file_item(self, path: Path) -> dict[str, str] | None:
        url = self.url_service.to_upload_url(path)
        if url is None:
            return None
        relative = path.relative_to(self.uploads_dir).as_posix()
        return {
            "path": str(path),
            "relative_path": relative,
            "url": url,
        }
