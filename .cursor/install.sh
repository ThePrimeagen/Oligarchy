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

# The integration lane (test/integration/*.integration.test.ts) starts a throwaway Postgres with
# Testcontainers, which needs a Docker daemon; the base image ships none. Install it (and the
# fuse-overlayfs snapshotter the nested VM uses) once here so the daemon start.sh brings up on
# every boot has a binary to run; the check-and-skip keeps a snapshot boot fast. Absent Docker the
# lane still runs, only its database-backed files skip (test/support/postgres.ts), so this never
# fails the install: a broken apt mirror must not stop a developing agent from running the checks.
if ! command -v dockerd >/dev/null 2>&1 || ! command -v fuse-overlayfs >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    # --force-confold keeps the image's /etc/fuse.conf so the conffile prompt never blocks on the
    # tty, and </dev/null turns any other maintainer prompt into an immediate default.
    (sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq \
      && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        -o Dpkg::Options::=--force-confold docker.io fuse-overlayfs) </dev/null \
      && echo "install: docker $(dockerd --version 2>/dev/null | head -1)" \
      || echo "install: docker install skipped; database-backed integration tests will skip" >&2
  else
    echo "install: apt-get not found; skipping docker (database-backed integration tests skip)" >&2
  fi
fi

# The lockfile is the source of truth; a developing agent needs node_modules to run every check
# (lint, format, types, unit) and both test lanes. `prepare` (effect-tsgo patch --oxlint) runs as
# part of the install, so the effecttsgo/* lint rules are patched in.
bun install --frozen-lockfile
echo "install: dependencies installed"
