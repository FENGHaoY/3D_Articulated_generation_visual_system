#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}/frontend-vue"

PORT="${1:-5173}"

if ! command -v npm >/dev/null 2>&1; then
  echo "[frontend-vue] npm not found."
  echo "  若使用 Conda，可安装: conda install -y -c conda-forge nodejs=20"
  echo "  其它环境请安装 Node.js LTS，然后: cd frontend-vue && npm install && npm run dev"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[frontend-vue] Installing dependencies (npm install)..."
  npm install
fi

echo "[frontend-vue] Building demo sample catalog from pm_test..."
python3 "${PROJECT_ROOT}/scripts/build_pm_demo_catalog.py"

echo "[frontend-vue] Starting Vite dev server on 0.0.0.0:${PORT} (proxy /api and /static -> 127.0.0.1:8000)"
exec npm run dev -- --host 0.0.0.0 --port "${PORT}"
