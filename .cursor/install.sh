#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "install: DATABASE_URL is not set" >&2
  exit 1
fi

# v2 runs on Node 26 (package.json engines, CI). The base image ships Node 22, whose npm 10
# resolves vite's optional esbuild peer differently and rejects package-lock.json under npm ci.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "install: nvm not found at $NVM_DIR; Node 26 is required" >&2
  exit 1
fi
. "$NVM_DIR/nvm.sh"
nvm install 26
nvm alias default 26
# nvm use only swaps the nvm entry already in PATH; put Node 26 first so nothing shadows it.
PATH="$(dirname "$(nvm which 26)"):$PATH"
export PATH
echo "install: node $(node --version), npm $(npm --version)"

cd v2
npm ci --ignore-scripts
# The tsgo patch only affects lint; a driving agent's environment must not fail on it.
npm run prepare || echo "install: effect-tsgo patch skipped" >&2
