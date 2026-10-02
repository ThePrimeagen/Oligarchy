#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# qemu-server runs QEMU as the agent user; open /dev/kvm when the host exposes it.
if [ -e /dev/kvm ]; then
  sudo chmod 666 /dev/kvm
fi

sudo service postgresql start
until pg_isready -q; do
  sleep 1
done

# Peer auth: the role name matches the agent user, so the URL carries no password.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ubuntu'" | grep -q 1; then
  sudo -u postgres createuser --login ubuntu
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='oligarchy'" | grep -q 1; then
  sudo -u postgres createdb --owner ubuntu oligarchy
fi

# Fill only keys that are absent. An existing .env (gitignored) keeps its own values.
ENV_FILE="$ROOT/.env"
touch "$ENV_FILE"
append_if_missing() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}
# host= selects the Unix socket (peer auth). The authority stays localhost so URL.canParse
# accepts it; node-postgres uses the socket directory from the query.
LOCAL_URL="postgres://ubuntu@localhost/oligarchy?host=/var/run/postgresql"
append_if_missing DATABASE_URL "$LOCAL_URL"
append_if_missing DATABASE_MIGRATION_URL "$LOCAL_URL"

# Migrations always hit the local database. A DATABASE_MIGRATION_URL already in the
# environment is left for the agent's own commands and is not used here.
DATABASE_MIGRATION_URL="$LOCAL_URL" bun run db:migrate

# Without KVM the server refuses to listen (every session uses accel=kvm). Postgres and
# the migrated database are still usable for the checks and unit tests.
if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
  echo "start: /dev/kvm is not readable and writable; qemu-server was not started" >&2
  exit 0
fi

# The process environment wins over .env. Prefer that token so the server matches the
# agent's own calls; otherwise the local default.
token="${OLIGARCHY_TOKEN:-}"
if [ -z "$token" ]; then
  token="$(grep '^OLIGARCHY_TOKEN=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
fi
if [ -z "$token" ]; then
  token="local-dev"
  append_if_missing OLIGARCHY_TOKEN "$token"
fi

stats_ok() {
  curl -fsS -o /dev/null -H "Authorization: Bearer ${token}" http://127.0.0.1:42069/stats 2>/dev/null
}

# Pin the listener to the local database. An inherited DATABASE_URL (a pooler, a shared
# test database) stays in the agent shell and is not what this process serves.
if ! stats_ok; then
  tmux kill-session -t qemu-server 2>/dev/null || true
  tmux new-session -d -s qemu-server -c "$ROOT" -- \
    env PATH="/usr/local/bin:${PATH}" DATABASE_URL="$LOCAL_URL" OLIGARCHY_TOKEN="$token" \
    ./qemu-server --port 42069 --automation --max-jobs 2 --name qemu-dev
  ready=0
  for _ in $(seq 1 30); do
    if stats_ok; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "start: qemu-server did not become ready" >&2
    tmux capture-pane -pt qemu-server >&2 || true
    exit 1
  fi
fi

echo "start: qemu-server ready on 127.0.0.1:42069"
