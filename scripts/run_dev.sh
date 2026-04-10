#!/usr/bin/env bash
# Start backend (background) + frontend (foreground). Ctrl+C stops both.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${1:-${API_PORT:-8000}}"
FRONTEND_PORT="${2:-8081}"

BACKEND_PID=""

cleanup() {
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo ""
    echo "[dev] Stopping backend (pid ${BACKEND_PID})..."
    kill "${BACKEND_PID}" 2>/dev/null || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[dev] Starting backend on port ${BACKEND_PORT} (background)..."
bash "${SCRIPT_DIR}/run_backend.sh" "${BACKEND_PORT}" &
BACKEND_PID=$!

echo "[dev] Waiting for backend to accept connections on 127.0.0.1:${BACKEND_PORT}..."
ready=0
for _ in $(seq 1 60); do
  if python3 - "${BACKEND_PORT}" <<'PY'
import socket
import sys

port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.3)
ok = s.connect_ex(("127.0.0.1", port)) == 0
s.close()
sys.exit(0 if ok else 1)
PY
  then
    ready=1
    break
  fi
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "[dev] Backend exited before the port was ready. See messages above."
    exit 1
  fi
  sleep 0.5
done

if [[ "${ready}" -ne 1 ]]; then
  echo "[dev] Timed out waiting for backend on port ${BACKEND_PORT}."
  exit 1
fi

echo "[dev] Starting frontend on port ${FRONTEND_PORT} (foreground; Ctrl+C stops both)..."
bash "${SCRIPT_DIR}/run_frontend.sh" "${FRONTEND_PORT}"
