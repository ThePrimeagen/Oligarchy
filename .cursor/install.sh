#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Nothing here needs DATABASE_URL. Environment builds run install without agent secrets.
# start.sh brings up local Postgres and the qemu server.

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  ovmf \
  postgresql \
  postgresql-client \
  qemu-system-x86 \
  qemu-utils

# qemu-server looks for Fedora's edk2 paths. Ubuntu's ovmf package ships the same 4M images
# under /usr/share/OVMF.
sudo mkdir -p /usr/share/edk2/x64
sudo ln -sfn /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/edk2/x64/OVMF_CODE.4m.fd
sudo ln -sfn /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/edk2/x64/OVMF_VARS.4m.fd

# The project runs on Bun 1.4.2 (package.json engines, CI). The installer puts it under
# ~/.bun; login shells do not load that profile, so the binary is also linked onto the
# default PATH.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
if [ ! -x "$BUN_INSTALL/bin/bun" ] || [ "$("$BUN_INSTALL/bin/bun" --version)" != "1.4.2" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"
fi
sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun
if [ -x "$BUN_INSTALL/bin/bunx" ]; then
  sudo ln -sf "$BUN_INSTALL/bin/bunx" /usr/local/bin/bunx
fi

echo "install: bun $(bun --version)"
bun install --frozen-lockfile
