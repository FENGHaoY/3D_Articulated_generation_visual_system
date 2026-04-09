from __future__ import annotations

from pathlib import Path


class StaticUrlService:
    def __init__(self, uploads_dir: Path, results_dir: Path) -> None:
        self.uploads_dir = uploads_dir
        self.results_dir = results_dir

    def to_upload_url(self, path: Path) -> str | None:
        try:
            rel = path.resolve().relative_to(self.uploads_dir.resolve()).as_posix()
        except ValueError:
            return None
        return f"/static/uploads/{rel}"

    def to_result_url(self, path: Path) -> str | None:
        try:
            rel = path.resolve().relative_to(self.results_dir.resolve()).as_posix()
        except ValueError:
            return None
        return f"/static/results/{rel}"
