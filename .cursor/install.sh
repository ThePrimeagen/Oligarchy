#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "install: DATABASE_URL is not set" >&2
  exit 1
fi

npm install
