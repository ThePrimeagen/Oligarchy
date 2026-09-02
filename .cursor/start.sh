#!/usr/bin/env bash
set -euo pipefail

# The proxy runs QEMU as the agent user; open /dev/kvm when the host exposes it.
if [ -e /dev/kvm ]; then
  sudo chmod 666 /dev/kvm
fi
