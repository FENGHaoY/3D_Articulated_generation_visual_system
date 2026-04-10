from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


TaskStatus = Literal["pending", "running", "succeeded", "failed"]


class CreateTaskRequest(BaseModel):
    upload_id: str = Field(..., min_length=8)
    n_samples: int = Field(default=1, ge=1, le=4)
    n_denoise_steps: int = Field(default=100, ge=10, le=200)
    omega: float = Field(default=0.5, ge=0.0, le=3.0)
    use_example_graph: Optional[bool] = None
    demo_sample_id: Optional[str] = None


class TaskRecord(BaseModel):
    task_id: str
    upload_id: str
    input_path: str
    output_dir: str
    status: TaskStatus
    progress: int = Field(default=0, ge=0, le=100)
    created_at: datetime
    updated_at: datetime
    error: Optional[str] = None
    pred_graph_url: Optional[str] = None
    requested_demo_sample_id: Optional[str] = None
    requested_pred_graph_path: Optional[str] = None
    samples: list[str] = Field(default_factory=list)
    sample_urls: list[str] = Field(default_factory=list)
    result_dir: Optional[str] = None
    metadata_json_path: Optional[str] = None
    metadata_json_url: Optional[str] = None
    mesh_file_path: Optional[str] = None
    mesh_file_url: Optional[str] = None
    preview_asset_path: Optional[str] = None
    preview_asset_url: Optional[str] = None
    log_path: Optional[str] = None
    log_url: Optional[str] = None
