#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${1:-8081}"

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

cleanup_frontend_port() {
  local port="$1"
  if is_port_busy "$port"; then
    echo "[frontend] Port ${port} is in use, cleaning old static server..."
    local pids
    pids="$(ps -ef | rg "python(3)? -m http.server ${port}" | rg -v "rg " | awk '{print $2}' || true)"
    if [ -n "${pids}" ]; then
      # shellcheck disable=SC2086
      kill ${pids} || true
      sleep 1
    fi
  fi

  if is_port_busy "$port"; then
    echo "[frontend] Port ${port} is still occupied. Please free it manually."
    exit 1
  fi
}

cleanup_frontend_port "${PORT}"
cd "${PROJECT_ROOT}/frontend"
echo "[frontend] Starting on 0.0.0.0:${PORT}"
python3 -m http.server "${PORT}"
