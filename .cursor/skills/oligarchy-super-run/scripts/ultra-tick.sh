#!/bin/sh
# ultra-tick.sh : one look at the current attempt, by phase (automation-ultra-logs/phase).
#  mint: each mint ticket's result and job (from /tmp/ultra-mints: "<ticket> <server> <result>"),
#        MINTED once both passed and both data dirs hold the disk, MINT-FAILED on a closed failure;
#  lock: tick.sh, then BATCH-DONE when SUPER_RUN_COUNT are counted and nothing is active.
# Always: FLEET-DOWN when fewer than six fleet ports listen.
set -u
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
cd "$ROOT"
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
PHASE=$(cat automation-ultra-logs/phase 2>/dev/null || echo none)
LISTENING=$(ss -ltn 2>/dev/null | grep -cE ':(55555|55332|55333|52222|52223|54321) ')
[ "$LISTENING" -lt 6 ] && echo "FLEET-DOWN only $LISTENING of 6 ports listening"
echo "PHASE $PHASE attempt $(cut -d' ' -f1 automation-ultra-logs/current 2>/dev/null)"
case "$PHASE" in
  mint)
    DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
    passed=0
    while read -r TICKET SERVER RID; do
      [ -n "$RID" ] || continue
      S=$(psql "$DBURL" -X -A -t -c "select r.status || '/' || coalesce((select j.status::text from automation_jobs j where j.result_id = r.result_id and j.action = 'mint'), '-') from test_results r where r.result_id = '$RID'")
      echo "MINT $TICKET $SERVER $S"
      case "$S" in
        passed/*) passed=$((passed + 1)) ;;
        failed/* | errored/* | aborted/* | timed_out/* | */failed | */errored | */aborted | */timed_out)
          echo "MINT-FAILED $TICKET $SERVER $RID $S" ;;
      esac
    done < /tmp/ultra-mints
    disks=0
    for s in 1 2; do
      ls "$DATA/qemu-$s/isos/"*.qcow2 "$DATA/qemu-$s/isos/"*.OVMF_VARS.fd >/dev/null 2>&1 && disks=$((disks + 1))
    done
    [ "$passed" -eq 2 ] && [ "$disks" -eq 2 ] && echo "MINTED both results passed; both dirs hold the disk"
    [ "$passed" -eq 2 ] && [ "$disks" -lt 2 ] && echo "MINT-FAILED passed but only $disks dirs hold the disk"
    ;;
  lock)
    OUT=$("$HERE/tick.sh" 2>&1)
    printf '%s\n' "$OUT" | grep -vE '^(skip|keep|removed) '
    if printf '%s\n' "$OUT" | grep -q "^LEDGER counted=${SUPER_RUN_COUNT:-10} active=0 "; then
      echo "BATCH-DONE"
    fi
    ;;
esac
exit 0
