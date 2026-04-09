from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.api.dependencies import get_settings
from app.core.config import Settings
from app.services.static_url_service import StaticUrlService

router = APIRouter(tags=["upload"])


def _save_upload(content: bytes, suffix: str, settings: Settings) -> dict[str, str]:
    upload_id = uuid4().hex
    filename = f"{upload_id}{suffix}"
    save_path = settings.uploads_dir / filename
    save_path.write_bytes(content)

    static_url_service = StaticUrlService(
        uploads_dir=settings.uploads_dir,
        results_dir=settings.results_dir,
    )
    return {
        "upload_id": upload_id,
        "file_path": str(save_path),
        "file_url": static_url_service.to_upload_url(save_path) or "",
    }


@router.post("/api/upload")
async def upload_image(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(status_code=400, detail="Only png/jpg/jpeg/webp is supported")

    content = await file.read()
    return _save_upload(content=content, suffix=ext, settings=settings)


@router.post("/api/upload-demo")
def upload_demo_image(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    demo_path = settings.singapo_root / "demo" / "demo_input.png"
    if not demo_path.exists():
        raise HTTPException(status_code=404, detail=f"Demo image not found: {demo_path}")
    content = demo_path.read_bytes()
    return _save_upload(content=content, suffix=".png", settings=settings)
