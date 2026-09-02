#!/usr/bin/env bash
set -euo pipefail

PG_VER="$(ls /usr/lib/postgresql/ | sort -n | tail -1)"
if ! pg_isready -q; then
  sudo pg_ctlcluster "$PG_VER" main start
fi

# The proxy runs QEMU as the agent user; open /dev/kvm when the host exposes it.
if [ -e /dev/kvm ]; then
  sudo chmod 666 /dev/kvm
fi
