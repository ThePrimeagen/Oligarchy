#!/usr/bin/env bash
set -euo pipefail

# The proxy and ./ctrl read DATABASE_URL from the environment and fail without it. Warn rather
# than fail: a developing agent runs the checks and tests against a local Postgres and never needs it.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "start: DATABASE_URL is not set; the proxy terminal and ./ctrl will not work" >&2
fi

# The proxy runs QEMU as the agent user; open /dev/kvm when the host exposes it.
if [ -e /dev/kvm ]; then
  sudo chmod 666 /dev/kvm
fi
