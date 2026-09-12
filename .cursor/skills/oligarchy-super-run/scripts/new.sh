#!/bin/sh
# new.sh [dir] : create the next lock-screen run; N is monotonic from $DEST/next.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
DIR="${1:-muse}"
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
[ -f "$DEST/next" ] || echo 1 > "$DEST/next"
N=$(cat "$DEST/next")
cd "$ROOT"
OUT=$(./ctrl test new \
  --server-url "${SUPER_RUN_SERVER_URL:-https://oligarchy-server.trm.sh}" \
  --iso "${SUPER_RUN_ISO:-https://iso.omarchy.org/omarchy-4.0.2.iso}" \
  --version "${SUPER_RUN_VERSION:-4.0.2}" \
  --name "${SUPER_RUN_TEST:-lock-screen}" 2>&1) || {
  echo "$OUT" >&2
  echo "new.sh: ctrl test new failed" >&2
  exit 1
}
JSON=$(printf '%s\n' "$OUT" | grep '^{' | tail -1)
RID=$(printf '%s\n' "$JSON" | jq -e -r '.tests[0].id') || {
  echo "$OUT" >&2
  echo "new.sh: no result id in ctrl output" >&2
  exit 1
}
TICKET=$(printf '%s\n' "$JSON" | jq -e -r '.tests[0].linear.identifier') || {
  echo "$OUT" >&2
  echo "new.sh: no ticket in ctrl output" >&2
  exit 1
}
printf '%s|%s|%s|%s|%s\n' "$N" "$DIR" "$RID" "$TICKET" "$(date -u +%FT%TZ)" >> "$DEST/active"
echo $((N + 1)) > "$DEST/next"
echo "started $DIR-$N $TICKET $RID"
waited=0
while [ "$waited" -lt 20 ]; do
  JOB=$(psql "$DBURL" -X -A -t -c "select status from automation_jobs where result_id='$RID' and action='drive'" || true)
  [ -n "$JOB" ] && break
  sleep 2
  waited=$((waited + 2))
done
if [ -z "${JOB:-}" ]; then
  echo "new.sh: no drive job after ${waited}s; pause refill (webhook?)" >&2
  exit 2
fi
