#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  qemu-system-x86 qemu-utils ovmf postgresql postgresql-client

# The proxy reads OVMF from /usr/share/edk2/x64; Ubuntu ships it under /usr/share/OVMF.
sudo mkdir -p /usr/share/edk2/x64
sudo ln -sf /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/edk2/x64/OVMF_CODE.4m.fd
sudo ln -sf /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/edk2/x64/OVMF_VARS.4m.fd

PG_VER="$(ls /usr/lib/postgresql/ | sort -n | tail -1)"
if ! pg_isready -q; then
  sudo pg_ctlcluster "$PG_VER" main start
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -c \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='oligarchy') THEN CREATE ROLE oligarchy LOGIN PASSWORD 'oligarchy'; END IF; END \$\$;"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='oligarchy'" | grep -q 1 \
  || sudo -u postgres createdb -O oligarchy oligarchy

npm ci

# Node's loadEnvFile() does not override an already-set DATABASE_URL, so any injected
# production secret still wins over this file; the dev commands set the local url inline.
if [ ! -f .env ]; then
  echo 'DATABASE_URL=postgresql://oligarchy:oligarchy@127.0.0.1:5432/oligarchy' > .env
fi

DATABASE_URL='postgresql://oligarchy:oligarchy@127.0.0.1:5432/oligarchy' npm run db:migrate
