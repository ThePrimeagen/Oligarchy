#!/bin/sh
# fleet.sh start|stop|status : the super-run's six processes (proxy, qemu-1, qemu-2, two
# automation clients, automation server), each in its own session so it outlives the caller.
# start refuses unless .local-env is exported (SERVER_URL is the local proxy) and every port is
# free; stop sends TERM, waits up to 30s, then KILLs whatever still holds a fleet port.
set -u
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
cd "$ROOT"
P=automation-super-run-logs/processes
DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
SESS="${OLIGARCHY_SESSIONS_DIR:-$HOME/personal/oligarchy-tmp}"
PORTS='55555|55332|55333|52222|52223|54321'

bound() { ss -ltnp 2>/dev/null | grep -E ":($PORTS) "; }

case "${1:-}" in
  start)
    if [ "${SERVER_URL:-}" != http://127.0.0.1:55555 ]; then
      echo "fleet.sh: SERVER_URL is not the local proxy; set -a; . ./.local-env; set +a" >&2
      exit 1
    fi
    if bound >/dev/null; then
      echo "fleet.sh: a fleet port is bound; fleet.sh stop first" >&2
      bound >&2
      exit 1
    fi
    mkdir -p "$P" "$SESS"
    : > "$P/pids"
    launch() {
      name=$1
      shift
      setsid "$@" > "$P/$name.log" 2>&1 < /dev/null &
      echo "$name $!" >> "$P/pids"
    }
    launch qemu-reverse-proxy ./qemu-reverse-proxy --port 55555
    launch qemu-1 env TMPDIR="$SESS" ./qemu-server --name qemu-1 --max-jobs 1 --port 55332 \
      --url http://127.0.0.1:55332 --data-dir "$DATA/qemu-1"
    launch qemu-2 env TMPDIR="$SESS" ./qemu-server --name qemu-2 --max-jobs 1 --port 55333 \
      --url http://127.0.0.1:55333 --data-dir "$DATA/qemu-2"
    launch automation-client-2a ./automation-client --name automation-client-2a --max-jobs 2 \
      --port 52222 --url http://127.0.0.1:52222
    launch automation-client-2b ./automation-client --name automation-client-2b --max-jobs 2 \
      --port 52223 --url http://127.0.0.1:52223
    launch automation-server ./automation-server --port 54321
    waited=0
    while [ "$(bound | wc -l)" -lt 6 ] && [ "$waited" -lt 30 ]; do
      sleep 1
      waited=$((waited + 1))
    done
    cat "$P/pids"
    if [ "$(bound | wc -l)" -lt 6 ]; then
      echo "fleet.sh: only $(bound | wc -l) of 6 ports listening after ${waited}s" >&2
      grep -hE 'fatal|error' "$P"/*.log | tail -5 >&2
      exit 1
    fi
    echo "fleet.sh: six listening"
    ;;
  stop)
    if [ -f "$P/pids" ]; then
      awk '{print $2}' "$P/pids" | while read -r pid; do
        kill -TERM "$pid" 2>/dev/null || true
      done
    fi
    waited=0
    while bound >/dev/null && [ "$waited" -lt 30 ]; do
      sleep 1
      waited=$((waited + 1))
    done
    left=$(bound | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
    if [ -n "$left" ]; then
      echo "fleet.sh: killing $left after ${waited}s" >&2
      kill -KILL $left 2>/dev/null || true
      sleep 1
    fi
    if bound >/dev/null; then
      echo "fleet.sh: ports still bound" >&2
      bound >&2
      exit 1
    fi
    echo "fleet.sh: stopped"
    ;;
  status)
    bound || echo "fleet.sh: nothing listening"
    ;;
  *)
    echo "usage: fleet.sh start|stop|status" >&2
    exit 1
    ;;
esac
