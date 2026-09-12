#!/bin/sh
# tick.sh : board, cleanup, ledger, retire/stuck/analyze lines. Agent acts on the printout.
set -u
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$ROOT"
"$HERE/board.sh"
"$HERE/cleanup.sh"
INDEX="automation-super-run-logs/index.tsv"
COUNTED=0
if [ -f "$INDEX" ]; then
  COUNTED=$(awk -F'\t' '$2=="COUNTED"{c++} END{print c+0}' "$INDEX")
fi
ACTIVE=0
[ -s "$DEST/active" ] && ACTIVE=$(grep -c . "$DEST/active")
REMAIN=$((100 - COUNTED))
[ "$REMAIN" -lt 0 ] && REMAIN=0
NEED=$((100 - COUNTED - ACTIVE))
[ "$NEED" -lt 0 ] && NEED=0
N_DRIVE=$(psql "$DBURL" -X -A -t -c "select count(*) from automation_jobs where action='drive' and status in ('running','pending')" || echo "?")
MEM=$(free -g | awk 'NR==2{print $7}')
REFILL=no
if [ "$NEED" -gt 0 ] && [ "$N_DRIVE" != "?" ] && [ "$N_DRIVE" -lt 2 ] && [ "${MEM:-0}" -ge 4 ]; then
  REFILL=yes
fi
echo "LEDGER counted=$COUNTED active=$ACTIVE remaining=$REMAIN need=$NEED drive_queue=$N_DRIVE mem_avail=${MEM}G refill=$REFILL"
[ -s "$DEST/active" ] || exit 0
VALS=$(awk -F'|' 'NF>=5{printf "%s(%s,'\''%s'\'', '\''%s'\''::uuid, '\''%s'\'', '\''%s'\'')", sep, $1, $2, $3, $4, $5; sep=","}' "$DEST/active")
[ -n "$VALS" ] || exit 0
psql "$DBURL" -X -A -t -F'|' -c "
  with a(n, dir, rid, ticket, created) as (values $VALS)
  select a.n, a.dir, a.rid::text, a.ticket,
    r.status::text,
    coalesce((select j.status::text from automation_jobs j where j.result_id=r.result_id and j.action='drive'),''),
    coalesce((select j.status::text from automation_jobs j where j.result_id=r.result_id and j.action='diagnose'),''),
    coalesce((select d.verdict::text from post_run_diagnosis d where d.session_id=r.session_id),''),
    extract(epoch from now()-r.created_at)::int
  from a join test_results r on r.result_id=a.rid
  order by a.n" | while IFS='|' read -r N DIR RID TICKET RSTATUS DRIVE DIAG VERDICT AGE; do
  [ -n "$N" ] || continue
  if [ -n "$VERDICT" ]; then
    echo "RETIRE $N|$DIR|$RID|$TICKET result=$RSTATUS drive=$DRIVE diagnose=${DIAG:--} verdict=$VERDICT"
    if [ "$RSTATUS" != "passed" ] || [ "$VERDICT" != "passed" ]; then
      echo "ANALYZE $N|$DIR|$RID|$TICKET result=$RSTATUS verdict=$VERDICT"
    fi
    continue
  fi
  if [ -z "$DRIVE" ] && [ "${AGE:-0}" -ge 60 ]; then
    echo "STUCK $N|$DIR|$RID|$TICKET no-drive-job age=${AGE}s — pause refill"
    continue
  fi
  case "$DIAG" in
    failed|aborted)
      echo "STUCK $N|$DIR|$RID|$TICKET diagnose=$DIAG no-diagnosis-row — ./ctrl diagnose or retire INFRA"
      echo "ANALYZE $N|$DIR|$RID|$TICKET diagnose=$DIAG"
      ;;
  esac
  case "$DRIVE" in
    failed|aborted)
      echo "STUCK $N|$DIR|$RID|$TICKET drive=$DRIVE result=$RSTATUS — close result / abort guest / diagnose or INFRA"
      echo "ANALYZE $N|$DIR|$RID|$TICKET drive=$DRIVE result=$RSTATUS"
      ;;
  esac
done
