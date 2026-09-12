#!/bin/sh
# retire.sh <n> [note] : record the run and drop it from the active list.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
N="$1"; NOTE="${2:-}"
LINE=$(grep "^$N|" "$DEST/active")
DIR=$(echo "$LINE" | cut -d'|' -f2)
RID=$(echo "$LINE" | cut -d'|' -f3)
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
"$HERE/record.sh" "$N" "$DIR" "$RID" "$NOTE"
grep -v "^$N|" "$DEST/active" > "$DEST/active.tmp" || true
mv "$DEST/active.tmp" "$DEST/active"
