from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import get_env_check_service
from app.services.env_check_service import EnvCheckService

router = APIRouter(tags=["system"])


@router.get("/api/env-check")
def env_check(service: EnvCheckService = Depends(get_env_check_service)) -> dict:
    return service.run()
