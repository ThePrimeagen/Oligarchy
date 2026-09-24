#!/bin/sh
# new.sh <dir> <iso-url> : create the next lock-screen run; N is monotonic from $DEST/next.
# <iso-url> is https://iso.omarchy.org/omarchy-<version>.iso; the version is read from the filename.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
[ "$#" -eq 2 ] || { echo "usage: new.sh <dir> <iso-url>" >&2; exit 1; }
DIR="$1"
ISO="$2"
VERSION=$(printf '%s\n' "$ISO" | sed -n 's#^https://.*/omarchy-\([0-9][0-9A-Za-z.-]*\)\.iso$#\1#p')
[ -n "$VERSION" ] || { echo "new.sh: $ISO is not an https omarchy-<version>.iso url" >&2; exit 1; }
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
[ -f "$DEST/next" ] || echo 1 > "$DEST/next"
N=$(cat "$DEST/next")
cd "$ROOT"
OUT=$(./ctrl test run \
  --server-url "${SUPER_RUN_SERVER_URL:-https://oligarchy-server.trm.sh}" \
  --iso "$ISO" \
  --version "$VERSION" \
  --name "${SUPER_RUN_TEST:-lock-screen}" 2>&1) || {
  echo "$OUT" >&2
  echo "new.sh: ctrl test run failed" >&2
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
  echo "new.sh: $TICKET has no drive job after ${waited}s. Stop refill; diagnose (automation-server log); retire.sh $N INFRA" >&2
  exit 2
fi
