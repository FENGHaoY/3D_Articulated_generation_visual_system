from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import (
    get_result_organizer,
    get_settings,
    get_storage,
    get_task_service,
)
from app.core.config import Settings
from app.models.task_schema import CreateTaskRequest, TaskRecord
from app.services.result_organizer import ResultOrganizer
from app.services.storage_service import StorageService
from app.services.task_service import TaskService

router = APIRouter(tags=["tasks"])


@router.post("/api/tasks", response_model=TaskRecord)
def create_task(
    request: CreateTaskRequest,
    settings: Settings = Depends(get_settings),
    task_service: TaskService = Depends(get_task_service),
) -> TaskRecord:
    input_path = None
    for candidate in settings.uploads_dir.glob(f"{request.upload_id}.*"):
        input_path = candidate
        break
    if input_path is None:
        raise HTTPException(status_code=404, detail="Upload not found")
    try:
        return task_service.create_task(request, input_path=input_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/tasks", response_model=list[TaskRecord])
def list_tasks(storage: StorageService = Depends(get_storage)) -> list[TaskRecord]:
    return storage.list_tasks()


@router.get("/api/tasks/{task_id}", response_model=TaskRecord)
def get_task(task_id: str, storage: StorageService = Depends(get_storage)) -> TaskRecord:
    task = storage.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/api/task/{task_id}/result")
def get_task_result(
    task_id: str,
    storage: StorageService = Depends(get_storage),
    result_organizer: ResultOrganizer = Depends(get_result_organizer),
) -> dict:
    task = storage.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return result_organizer.build_and_write(task)
