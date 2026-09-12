#!/bin/sh
# reset.sh [--force] : remove the previous super run so the next batch starts from zero.
# Removes: automation-super-run-logs/{index.tsv,*/}, SCRATCH.md, TODOS.md, and the
# /tmp/superrun ledger (active, next, current, last-new.json, cleanup.psql.err).
# Recreates empty dirs, an empty active, next=1, and fresh SCRATCH.md / TODOS.md.
# Never touches the database, Linear, or session dirs (cleanup.sh owns those).
# Refuses while runs are in flight or a fleet port is bound; --force skips both guards.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
FORCE=no
case "$#" in
  0) ;;
  1)
    [ "$1" = "--force" ] || {
      echo "usage: reset.sh [--force]" >&2
      exit 1
    }
    FORCE=yes
    ;;
  *)
    echo "usage: reset.sh [--force]" >&2
    exit 1
    ;;
esac
cd "$ROOT"
LOGS=automation-super-run-logs

if [ "$FORCE" = no ]; then
  if [ -s "$DEST/active" ]; then
    echo "reset.sh: runs still in flight in $DEST/active; retire them first (or --force):" >&2
    cat "$DEST/active" >&2
    exit 1
  fi
  if ! SOCKETS=$(ss -ltnp 2>&1); then
    echo "reset.sh: cannot inspect fleet ports:" >&2
    printf '%s\n' "$SOCKETS" >&2
    exit 1
  fi
  BOUND=$(printf '%s\n' "$SOCKETS" | grep -E ':(55555|55332|55333|52222|52223|54321) ' || true)
  if [ -n "$BOUND" ]; then
    echo "reset.sh: fleet ports still bound; stop those processes first (or --force):" >&2
    echo "$BOUND" >&2
    exit 1
  fi
fi

for p in "$LOGS"/index.tsv "$LOGS"/*/ SCRATCH.md TODOS.md \
         "$DEST/active" "$DEST/next" "$DEST/current" "$DEST/last-new.json" "$DEST/cleanup.psql.err"; do
  [ -e "$p" ] || continue
  rm -rf "$p"
  echo "removed $p"
done

mkdir -p "$LOGS/muse" "$LOGS/processes" "$DEST"
: > "$DEST/active"
echo 1 > "$DEST/next"
printf '# Super-run scratch\n\nBatch started %s. Live pad. Never paste secrets.\n' "$(date -u +%FT%TZ)" > SCRATCH.md
printf '# Super-run TODOs\n\nNon-blocking findings only.\n' > TODOS.md
echo "reset: $LOGS empty, ledger next=1, SCRATCH.md and TODOS.md fresh"
