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

# The Docker daemon the integration lane's Testcontainers Postgres needs. install.sh put the
# binary on disk; a disk snapshot keeps the binary but not the process, so start it here on every
# boot. Idempotent: if the socket already answers, leave the running daemon alone.
if command -v dockerd >/dev/null 2>&1; then
  # Testcontainers (running as the agent user) talks to the socket directly, so the user must
  # reach it; the group and membership survive a snapshot, the socket mode is reset per boot below.
  sudo groupadd -f docker
  sudo usermod -aG docker "$(id -un)"
  if ! docker version >/dev/null 2>&1; then
    sudo sh -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'
    for _ in $(seq 1 30); do
      if [ -S /var/run/docker.sock ] && sudo docker version >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi
  if [ -S /var/run/docker.sock ]; then
    sudo chmod 666 /var/run/docker.sock
    echo "start: docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'not ready')"
  else
    echo "start: docker daemon did not come up; database-backed integration tests will skip" >&2
  fi
fi
