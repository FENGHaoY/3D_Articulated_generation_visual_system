#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}/backend"

if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_ROOT}/.env"
  set +a
fi

PORT="${1:-${API_PORT:-8000}}"
HOST="${API_HOST:-0.0.0.0}"

is_port_busy() {
  local port="$1"
  python3 - "$port" <<'PY'
import socket
import sys
port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.2)
busy = s.connect_ex(("127.0.0.1", port)) == 0
s.close()
sys.exit(0 if busy else 1)
PY
}

cleanup_backend_port() {
  local port="$1"
  if is_port_busy "$port"; then
    echo "[backend] Port ${port} is in use, cleaning old backend process..."
    local pids
    pids="$(ps -ef | rg "uvicorn app.main:app.*--port ${port}" | rg -v "rg " | awk '{print $2}' || true)"
    if [ -n "${pids}" ]; then
      # shellcheck disable=SC2086
      kill ${pids} || true
      sleep 1
    fi
  fi

  if is_port_busy "$port"; then
    echo "[backend] Port ${port} is still occupied. Please free it manually."
    exit 1
  fi
}

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt
cleanup_backend_port "${PORT}"
echo "[backend] Starting on ${HOST}:${PORT}"
uvicorn app.main:app --host "${HOST}" --port "${PORT}" --reload
