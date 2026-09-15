#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Nothing here needs DATABASE_URL, and environment builds run install without agent secrets,
# so it must not be required; start.sh reports it missing at boot instead.

# The project runs on Bun (package.json engines, CI); the base image ships none. The installer
# puts it under ~/.bun and adds that to the shell profile for the terminals that follow.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
if [ ! -x "$BUN_INSTALL/bin/bun" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"
fi
PATH="$BUN_INSTALL/bin:$PATH"
export PATH
echo "install: bun $(bun --version)"
