#!/bin/sh
# new.sh <n> <dir> : create the next lock-screen run; append N|DIR|RID|TICKET|CREATED.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
N="$1"; DIR="$2"
cd "$ROOT"
OUT=$(./ctrl test new \
  --server-url "${SUPER_RUN_SERVER_URL:-https://oligarchy-server.trm.sh}" \
  --iso "${SUPER_RUN_ISO:-https://iso.omarchy.org/omarchy-4.0.2.iso}" \
  --version "${SUPER_RUN_VERSION:-4.0.2}" \
  --name "${SUPER_RUN_TEST:-lock-screen}" 2>&1)
JSON=$(echo "$OUT" | grep '^{' | tail -1)
RID=$(echo "$JSON" | jq -r '.tests[0].id'); TICKET=$(echo "$JSON" | jq -r '.tests[0].linear.identifier')
printf '%s|%s|%s|%s|%s\n' "$N" "$DIR" "$RID" "$TICKET" "$(date -u +%FT%TZ)" >> "$DEST/active"
echo "started $DIR-$N $TICKET $RID"
