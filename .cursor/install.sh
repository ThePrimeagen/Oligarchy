#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "install: DATABASE_URL is not set" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  qemu-system-x86 qemu-utils ovmf

# The proxy reads OVMF from /usr/share/edk2/x64; Ubuntu ships it under /usr/share/OVMF.
sudo mkdir -p /usr/share/edk2/x64
sudo ln -sf /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/edk2/x64/OVMF_CODE.4m.fd
sudo ln -sf /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/edk2/x64/OVMF_VARS.4m.fd

npm ci
npm run db:migrate
