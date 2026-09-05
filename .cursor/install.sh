#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "install: DATABASE_URL is not set" >&2
  exit 1
fi

cd v2
npm ci --ignore-scripts
# The tsgo patch only affects lint; a driving agent's environment must not fail on it.
npm run prepare || echo "install: effect-tsgo patch skipped" >&2
