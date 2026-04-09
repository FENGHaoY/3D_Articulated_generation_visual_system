#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
IMG_PATH="${2:-../singapo/demo/demo_input.png}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ABS_IMG_PATH="$(cd "${PROJECT_ROOT}" && realpath "${IMG_PATH}")"

echo "[1/3] Uploading image: ${ABS_IMG_PATH}"
UPLOAD_RESP="$(curl -sS -X POST "${BASE_URL}/api/upload" -F "file=@${ABS_IMG_PATH}")"
echo "${UPLOAD_RESP}"
UPLOAD_ID="$(printf "%s" "${UPLOAD_RESP}" | python3 -c 'import sys, json; print(json.load(sys.stdin)["upload_id"])')"

echo "[2/3] Creating task"
TASK_RESP="$(curl -sS -X POST "${BASE_URL}/api/tasks" -H "Content-Type: application/json" -d "{\"upload_id\":\"${UPLOAD_ID}\",\"n_samples\":1}")"
echo "${TASK_RESP}"
TASK_ID="$(printf "%s" "${TASK_RESP}" | python3 -c 'import sys, json; print(json.load(sys.stdin)["task_id"])')"

echo "[3/3] Polling task status"
for i in $(seq 1 120); do
  STATUS_RESP="$(curl -sS "${BASE_URL}/api/tasks/${TASK_ID}")"
  STATUS="$(printf "%s" "${STATUS_RESP}" | python3 -c 'import sys, json; print(json.load(sys.stdin)["status"])')"
  echo "try=${i}, status=${STATUS}"
  if [ "${STATUS}" = "succeeded" ] || [ "${STATUS}" = "failed" ]; then
    echo "${STATUS_RESP}"
    exit 0
  fi
  sleep 2
done

echo "Timeout waiting for task completion"
exit 1
