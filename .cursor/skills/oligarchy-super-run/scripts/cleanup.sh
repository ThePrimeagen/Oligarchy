#!/bin/sh
# cleanup.sh : remove session dirs that are not running.
# Never delete when the DB query fails.
set -u
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
cd "$ROOT"
SESS_TMP="${OLIGARCHY_SESSIONS_DIR:-$HOME/personal/oligarchy-tmp}"
RUNNING=$(psql "$DBURL" -X -A -t -c "select id from sessions where status in ('running','downloading')" 2>"$DEST/cleanup.psql.err")
if [ $? -ne 0 ]; then
  echo "cleanup: db query failed; keeping all session dirs"
  cat "$DEST/cleanup.psql.err"
  echo "tmpfs: $(df -h /tmp | awk 'NR==2{print $3" used of "$2}'); sessions on disk: $(du -sh "$SESS_TMP" 2>/dev/null | cut -f1)"
  exit 0
fi
for d in /tmp/oligarchy-* "$SESS_TMP"/oligarchy-*; do
  [ -d "$d" ] || continue
  sid=${d##*/oligarchy-}
  case "$sid" in
    *-*-*-*-*) ;;
    *) echo "skip $d (not a session uuid)"; continue ;;
  esac
  if printf '%s\n' "$RUNNING" | grep -qx "$sid"; then
    echo "keep $d (running, $(du -sh "$d" | cut -f1))"
  else
    rm -rf "$d" && echo "removed $d (not running)"
  fi
done
echo "tmpfs: $(df -h /tmp | awk 'NR==2{print $3" used of "$2}'); sessions on disk: $(du -sh "$SESS_TMP" 2>/dev/null | cut -f1)"
