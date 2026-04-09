from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.dependencies import init_dependencies
from app.api.routes_system import router as system_router
from app.api.routes_tasks import router as tasks_router
from app.api.routes_upload import router as upload_router
from app.core.config import load_settings
from app.services.env_check_service import EnvCheckService
from app.services.result_organizer import ResultOrganizer
from app.services.singapo_runner import SingapoRunner
from app.services.static_url_service import StaticUrlService
from app.services.storage_service import StorageService
from app.services.task_service import TaskService

settings = load_settings()
for folder in [
    settings.runtime_root,
    settings.uploads_dir,
    settings.jobs_dir,
    settings.results_dir,
    settings.logs_dir,
]:
    folder.mkdir(parents=True, exist_ok=True)

storage = StorageService(settings.tasks_db_file)
result_organizer = ResultOrganizer(
    uploads_dir=settings.uploads_dir,
    results_dir=settings.results_dir,
)
static_url_service = StaticUrlService(
    uploads_dir=settings.uploads_dir,
    results_dir=settings.results_dir,
)
singapo_runner = SingapoRunner(
    project_root=settings.project_root,
    singapo_root=settings.singapo_root,
    gt_data_root=settings.project_root / "data",
    outputs_dir=settings.results_dir,
    logs_dir=settings.logs_dir,
    singapo_python=settings.singapo_python,
    singapo_conda_env=settings.singapo_conda_env,
    openai_api_key=settings.openai_api_key,
    singapo_dino_local_first=settings.singapo_dino_local_first,
)
task_service = TaskService(
    storage_service=storage,
    singapo_runner=singapo_runner,
    result_organizer=result_organizer,
    results_dir=settings.results_dir,
    static_url_service=static_url_service,
    default_use_example_graph=settings.default_use_example_graph,
)
env_check_service = EnvCheckService(settings=settings)

init_dependencies(
    settings=settings,
    storage=storage,
    task_service=task_service,
    result_organizer=result_organizer,
    env_check_service=env_check_service,
)

app = FastAPI(title="SINGAPO MVP Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/static/uploads",
    StaticFiles(directory=str(settings.uploads_dir), check_dir=True),
    name="static-uploads",
)
app.mount(
    "/static/results",
    StaticFiles(directory=str(settings.results_dir), check_dir=True),
    name="static-results",
)
app.mount(
    "/static/demo",
    StaticFiles(directory=str(settings.singapo_root / "demo"), check_dir=True),
    name="static-demo",
)

app.include_router(upload_router)
app.include_router(tasks_router)
app.include_router(system_router)

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
