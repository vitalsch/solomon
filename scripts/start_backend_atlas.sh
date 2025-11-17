#!/usr/bin/env bash
set -euo pipefail

# Start the backend pointing at the Atlas cluster.
# Usage: ./scripts/start_backend_atlas.sh

export MONGODB_URI="${MONGODB_URI:-mongodb+srv://eugen:Jasmin.2021@cluster0.ohdjwwo.mongodb.net/}"
export MONGODB_DB="${MONGODB_DB:-wealth_planner}"
export SKIP_MONGO=1

exec "$(dirname "$0")/start_backend.sh"
