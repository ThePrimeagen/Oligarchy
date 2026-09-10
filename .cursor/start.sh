#!/usr/bin/env bash
set -euo pipefail

# qemu-server and ./ctrl read DATABASE_URL from the environment and fail without it. Warn rather
# than fail: a developing agent runs the checks and tests against a local Postgres and never needs it.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "start: DATABASE_URL is not set; the qemu-server terminal and ./ctrl will not work" >&2
fi

# qemu-server runs QEMU as the agent user; open /dev/kvm when the host exposes it.
if [ -e /dev/kvm ]; then
  sudo chmod 666 /dev/kvm
fi
