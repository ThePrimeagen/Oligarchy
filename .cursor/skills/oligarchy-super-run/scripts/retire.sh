#!/bin/sh
# retire.sh <n> <COUNTED|INFRA> [note] : record the run and drop it from active.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
N="${1:?usage: retire.sh <n> COUNTED|INFRA [note]}"
KIND="${2:?usage: retire.sh <n> COUNTED|INFRA [note]}"
NOTE="${3:-}"
case "$KIND" in
  COUNTED|INFRA) ;;
  *) echo "retire.sh: kind must be COUNTED or INFRA" >&2; exit 1 ;;
esac
LINE=$(grep "^$N|" "$DEST/active") || {
  echo "retire.sh: no active run $N" >&2
  exit 1
}
DIR=$(echo "$LINE" | cut -d'|' -f2)
RID=$(echo "$LINE" | cut -d'|' -f3)
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
"$HERE/record.sh" "$N" "$DIR" "$RID" "$KIND" "$NOTE"
grep -v "^$N|" "$DEST/active" > "$DEST/active.tmp" || true
mv "$DEST/active.tmp" "$DEST/active"
