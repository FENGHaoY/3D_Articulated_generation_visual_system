from __future__ import annotations

from pathlib import Path
from threading import Thread
from uuid import uuid4

from app.models.task_schema import CreateTaskRequest, TaskRecord
from app.services.result_organizer import ResultOrganizer
from app.services.singapo_runner import SingapoRunError, SingapoRunner
from app.services.static_url_service import StaticUrlService
from app.services.storage_service import StorageService


class TaskService:
    def __init__(
        self,
        storage_service: StorageService,
        singapo_runner: SingapoRunner,
        result_organizer: ResultOrganizer,
        results_dir: Path,
        static_url_service: StaticUrlService,
        default_use_example_graph: bool,
    ) -> None:
        self.storage = storage_service
        self.runner = singapo_runner
        self.result_organizer = result_organizer
        self.results_dir = results_dir
        self.static_url_service = static_url_service
        self.default_use_example_graph = default_use_example_graph
        self.pm_test_graph_dir = (
            self.runner.singapo_root / "exps" / "pred_graph" / "pred_graph" / "pm_test"
        )

    def create_task(self, request: CreateTaskRequest, input_path: Path) -> TaskRecord:
        now = self.storage.now()
        task_id = uuid4().hex
        output_dir = self.results_dir / task_id

        requested_pred_graph_path = self._resolve_demo_graph_path(request.demo_sample_id)

        task = TaskRecord(
            task_id=task_id,
            upload_id=request.upload_id,
            input_path=str(input_path),
            output_dir=str(output_dir),
            status="pending",
            progress=0,
            created_at=now,
            updated_at=now,
            requested_demo_sample_id=request.demo_sample_id,
            requested_pred_graph_path=str(requested_pred_graph_path)
            if requested_pred_graph_path is not None
            else None,
        )
        self.storage.create_task(task)

        use_example_graph = (
            request.use_example_graph
            if request.use_example_graph is not None
            else self.default_use_example_graph
        )

        thread = Thread(
            target=self._run_task,
            args=(
                task_id,
                input_path,
                request.n_samples,
                request.n_denoise_steps,
                request.omega,
                use_example_graph,
                requested_pred_graph_path,
            ),
            daemon=True,
        )
        thread.start()

        return task

    def _run_task(
        self,
        task_id: str,
        input_path: Path,
        n_samples: int,
        n_denoise_steps: int,
        omega: float,
        use_example_graph: bool,
        requested_pred_graph_path: Path | None,
    ) -> None:
        self.storage.update_task(task_id, status="running", progress=5, error=None)
        try:
            progress_state = {"value": 5}

            def update_progress(value: int) -> None:
                value = max(progress_state["value"], min(99, value))
                if value > progress_state["value"]:
                    progress_state["value"] = value
                    self.storage.update_task(task_id, progress=value)

            run_result = self.runner.run_demo_inference(
                task_id=task_id,
                img_path=input_path,
                n_samples=n_samples,
                n_denoise_steps=n_denoise_steps,
                omega=omega,
                use_example_graph=use_example_graph,
                pred_graph_override_path=requested_pred_graph_path,
                progress_callback=update_progress,
            )

            samples: list[str] = []
            sample_urls: list[str] = []
            for object_json in run_result.sample_object_json_paths:
                relative_path = object_json.relative_to(run_result.task_result_dir).as_posix()
                samples.append(relative_path)
                url = self.static_url_service.to_result_url(object_json)
                if url is not None:
                    sample_urls.append(url)

            pred_graph_url = None
            if run_result.pred_graph_path is not None:
                pred_graph_url = self.static_url_service.to_result_url(
                    run_result.pred_graph_path
                )

            mesh_file_url = None
            if run_result.mesh_file_path is not None:
                mesh_file_url = self.static_url_service.to_result_url(run_result.mesh_file_path)

            preview_asset_url = None
            if run_result.preview_asset_path is not None:
                preview_asset_url = self.static_url_service.to_result_url(
                    run_result.preview_asset_path
                )

            metadata_json_url = self.static_url_service.to_result_url(
                run_result.metadata_json_path
            )

            log_url = self.static_url_service.to_result_url(run_result.task_run_log_path)

            updated = self.storage.update_task(
                task_id,
                status="succeeded",
                progress=100,
                samples=samples,
                sample_urls=sample_urls,
                pred_graph_url=pred_graph_url,
                result_dir=str(run_result.task_result_dir),
                metadata_json_path=str(run_result.metadata_json_path),
                metadata_json_url=metadata_json_url,
                mesh_file_path=str(run_result.mesh_file_path)
                if run_result.mesh_file_path is not None
                else None,
                mesh_file_url=mesh_file_url,
                preview_asset_path=str(run_result.preview_asset_path)
                if run_result.preview_asset_path is not None
                else None,
                preview_asset_url=preview_asset_url,
                log_path=str(run_result.run_log_path),
                log_url=log_url,
            )
            self.result_organizer.build_and_write(updated)
        except SingapoRunError as exc:
            task_log_copy = self.results_dir / task_id / "run.log"
            updated = self.storage.update_task(
                task_id,
                status="failed",
                progress=100,
                error=str(exc),
                log_path=str(exc.log_path),
                log_url=self.static_url_service.to_result_url(task_log_copy),
            )
            self.result_organizer.build_and_write(updated)
        except Exception as exc:  # noqa: BLE001
            updated = self.storage.update_task(
                task_id, status="failed", progress=100, error=str(exc)
            )
            self.result_organizer.build_and_write(updated)

    def _resolve_demo_graph_path(self, demo_sample_id: str | None) -> Path | None:
        if not demo_sample_id:
            return None
        parts = demo_sample_id.split("@")
        if len(parts) != 3 or any(not p for p in parts):
            raise ValueError(
                f"Invalid demo_sample_id={demo_sample_id!r}, expected <Category>@<model_id>@<view_id>"
            )
        candidate = (self.pm_test_graph_dir / f"{demo_sample_id}.json").resolve()
        pm_root = self.pm_test_graph_dir.resolve()
        if pm_root not in candidate.parents or not candidate.exists():
            raise ValueError(
                f"demo_sample_id={demo_sample_id!r} has no matching pred_graph under {pm_root}"
            )
        return candidate

