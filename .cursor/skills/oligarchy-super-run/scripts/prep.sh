#!/bin/sh
# prep.sh <attempt> <iso-url> : one fresh super-run. Archives the previous attempt's logs and pad
# under automation-ultra-logs/attempt-<n-1>/, stops the fleet, resets the ledger, clears local
# data, database stragglers and Linear stragglers (clear.sh), downloads the ISO into both data
# dirs, and starts the fleet. Sentry is cleared by the operator, not here.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
[ "$#" -eq 2 ] || { echo "usage: prep.sh <attempt> <iso-url>" >&2; exit 1; }
ATTEMPT="$1"
ISO="$2"
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$ROOT"
ARCHIVE=automation-ultra-logs
mkdir -p "$ARCHIVE"
if [ -f automation-super-run-logs/index.tsv ] && [ "$ATTEMPT" -gt 1 ]; then
  PREV="$ARCHIVE/attempt-$(printf '%02d' $((ATTEMPT - 1)))"
  mkdir -p "$PREV"
  cp -r automation-super-run-logs/. "$PREV/"
  cp SCRATCH.md TODOS.md "$PREV/" 2>/dev/null || true
  echo "prep.sh: archived the previous attempt to $PREV"
fi
"$HERE/fleet.sh" stop
"$HERE/reset.sh" --force
"$HERE/clear.sh"
"$HERE/download.sh" "$ISO"
"$HERE/fleet.sh" start
printf '\nAttempt %s. ISO %s.\n' "$ATTEMPT" "$ISO" >> SCRATCH.md
