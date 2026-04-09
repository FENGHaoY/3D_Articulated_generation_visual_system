from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Dict
from uuid import uuid4

from app.models.task_schema import TaskRecord


class StorageService:
    def __init__(self, tasks_db_file: Path) -> None:
        self.tasks_db_file = tasks_db_file
        self._lock = Lock()
        self._tasks: Dict[str, TaskRecord] = {}
        self._load()

    def _load(self) -> None:
        if not self.tasks_db_file.exists():
            return
        raw = json.loads(self.tasks_db_file.read_text(encoding="utf-8"))
        self._tasks = {
            task_id: TaskRecord.model_validate(payload) for task_id, payload in raw.items()
        }

    def _save(self) -> None:
        payload = {
            task_id: task.model_dump(mode="json") for task_id, task in self._tasks.items()
        }
        self.tasks_db_file.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def create_upload_filename(self, extension: str) -> str:
        return f"{uuid4().hex}{extension}"

    def now(self) -> datetime:
        return datetime.now(timezone.utc)

    def create_task(self, task: TaskRecord) -> TaskRecord:
        with self._lock:
            self._tasks[task.task_id] = task
            self._save()
            return task

    def update_task(self, task_id: str, **updates: object) -> TaskRecord:
        with self._lock:
            task = self._tasks[task_id]
            merged = task.model_copy(update={**updates, "updated_at": self.now()})
            self._tasks[task_id] = merged
            self._save()
            return merged

    def get_task(self, task_id: str) -> TaskRecord | None:
        with self._lock:
            return self._tasks.get(task_id)

    def list_tasks(self) -> list[TaskRecord]:
        with self._lock:
            return sorted(
                self._tasks.values(),
                key=lambda item: item.created_at,
                reverse=True,
            )
