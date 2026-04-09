from __future__ import annotations

from fastapi import HTTPException

from app.core.config import Settings
from app.services.env_check_service import EnvCheckService
from app.services.result_organizer import ResultOrganizer
from app.services.storage_service import StorageService
from app.services.task_service import TaskService

_settings: Settings | None = None
_storage: StorageService | None = None
_task_service: TaskService | None = None
_result_organizer: ResultOrganizer | None = None
_env_check_service: EnvCheckService | None = None


def init_dependencies(
    *,
    settings: Settings,
    storage: StorageService,
    task_service: TaskService,
    result_organizer: ResultOrganizer,
    env_check_service: EnvCheckService,
) -> None:
    global _settings, _storage, _task_service, _result_organizer, _env_check_service
    _settings = settings
    _storage = storage
    _task_service = task_service
    _result_organizer = result_organizer
    _env_check_service = env_check_service


def get_settings() -> Settings:
    if _settings is None:
        raise HTTPException(status_code=500, detail="Settings not initialized")
    return _settings


def get_storage() -> StorageService:
    if _storage is None:
        raise HTTPException(status_code=500, detail="Storage not initialized")
    return _storage


def get_task_service() -> TaskService:
    if _task_service is None:
        raise HTTPException(status_code=500, detail="Task service not initialized")
    return _task_service


def get_result_organizer() -> ResultOrganizer:
    if _result_organizer is None:
        raise HTTPException(status_code=500, detail="Result organizer not initialized")
    return _result_organizer


def get_env_check_service() -> EnvCheckService:
    if _env_check_service is None:
        raise HTTPException(status_code=500, detail="Env check service not initialized")
    return _env_check_service
