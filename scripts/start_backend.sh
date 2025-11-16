#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

compose_cmd="docker compose"
if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required. Please install Docker Desktop." >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    if command -v docker-compose >/dev/null 2>&1; then
        compose_cmd="docker-compose"
    else
        echo "Neither 'docker compose' nor 'docker-compose' is available." >&2
        exit 1
    fi
fi

# -----------------------------------------------------------------------------
# Launch MongoDB container
# -----------------------------------------------------------------------------

echo "Starting MongoDB via docker compose..."
$compose_cmd up -d mongo

# -----------------------------------------------------------------------------
# Environment setup
# -----------------------------------------------------------------------------

export MONGODB_DB="${MONGODB_DB:-wealth_planner}"
export MONGODB_URI="${MONGODB_URI:-mongodb://root:example@localhost:27017/?authSource=admin}"

VENV_PATH="${VENV_PATH:-$REPO_ROOT/.env}"
if [ -z "${SKIP_VENV:-}" ] && [ -f "$VENV_PATH/bin/activate" ]; then
    # shellcheck source=/dev/null
    source "$VENV_PATH/bin/activate"
elif [ -z "${SKIP_VENV:-}" ]; then
    echo "Virtual environment not found at $VENV_PATH. Set VENV_PATH or SKIP_VENV=1." >&2
fi

UVICORN_APP="${UVICORN_APP:-backend.api:app}"
UVICORN_HOST="${UVICORN_HOST:-127.0.0.1}"
UVICORN_PORT="${UVICORN_PORT:-8000}"

echo "Starting uvicorn (${UVICORN_APP}) on ${UVICORN_HOST}:${UVICORN_PORT}..."
exec uvicorn "$UVICORN_APP" --host "$UVICORN_HOST" --port "$UVICORN_PORT" --reload
