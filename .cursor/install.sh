#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Nothing here needs DATABASE_URL, and environment builds run install without agent secrets,
# so it must not be required; start.sh reports it missing at boot instead.

# The code runs on Node 26 (package.json engines, CI). The base image ships Node 22, whose npm 10
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
