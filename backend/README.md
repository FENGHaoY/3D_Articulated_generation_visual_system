# Backend (FastAPI)

MVP backend for image upload, task creation, and SINGAPO inference trigger.

## Run

```bash
cp ../.env.example ../.env
# keep SINGAPO_CONDA_ENV=singapo (your conda env name)
# or set SINGAPO_PYTHON as fallback

bash ../scripts/run_backend.sh
# optional custom port:
# bash ../scripts/run_backend.sh 8001
```

Inference is executed via `conda run -n singapo python demo/demo.py` by default.
The adapter layer is `app/services/singapo_runner.py` (minimal-intrusion wrapper).

## API

- `GET /api/health`
- `POST /api/upload` (multipart file)
- `POST /api/tasks` (json body)
- `GET /api/tasks`
- `GET /api/tasks/{task_id}`
- `GET /api/task/{task_id}/result` (normalized result manifest)
- `GET /api/env-check` (runtime environment diagnostics)

Static files are served under:
- `/static/uploads/...`
- `/static/results/...`

Task logs are written to `runtime/logs/<task_id>.log`.
Each task output directory includes `meta.json` and `result_manifest.json`.
