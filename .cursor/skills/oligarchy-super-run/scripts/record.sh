#!/bin/sh
# record.sh <n> <dir: muse> <result_id> <COUNTED|INFRA> [note]
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
N="$1"; DIR="$2"; RID="$3"; KIND="$4"; NOTE="${5:-}"
case "$KIND" in
  COUNTED|INFRA) ;;
  *) echo "record.sh: kind must be COUNTED or INFRA" >&2; exit 1 ;;
esac
cd "$ROOT"
Q() { psql "$DBURL" -X -A -t -F '|' -c "$1"; }
IFS='|' read -r TICKET RSTATUS MODEL SID RREASON RCREATED RFINISHED <<EOT
$(Q "select linear_id, status, coalesce(model,''), coalesce(session_id::text,''), coalesce(replace(reason,E'\n',' '),''), to_char(created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), coalesce(to_char(finished_at at time zone 'UTC','HH24:MI:SS\"Z\"'),'') from test_results where result_id='$RID'")
EOT
JOB() { Q "select status||' ('||coalesce(to_char(started_at at time zone 'UTC','HH24:MI:SS'),'-')||' -> '||coalesce(to_char(finished_at at time zone 'UTC','HH24:MI:SS'),'-')||')'||coalesce('; '||regexp_replace(regexp_replace(regexp_replace(reason, E'\\x1b\\[[0-9;]*m', '', 'g'), E'\\s+$', ''), E'^(.*\\n)*', ''),'') from automation_jobs where result_id='$RID' and action='$1'"; }
DRIVE=$(JOB drive); DIAGJ=$(JOB diagnose)
DSTATUS=$(Q "select status from automation_jobs where result_id='$RID' and action='drive'"); JSTATUS=$(Q "select status from automation_jobs where result_id='$RID' and action='diagnose'")
SESS=$(Q "select s.status||coalesce('; '||s.reason,'')||' ('||to_char(s.started_at at time zone 'UTC','HH24:MI:SS')||' -> '||coalesce(to_char(s.ended_at at time zone 'UTC','HH24:MI:SS'),'-')||'); '||(select count(*) from actions a where a.session_id=s.id)||' actions, '||(select count(*) from images i join actions a on a.id=i.action_id where a.session_id=s.id)||' images' from sessions s where s.id::text='$SID'")
IFS='|' read -r VERDICT ETYPE DMODEL SUMMARY <<EOT
$(Q "select d.verdict, coalesce(d.error_type,''), d.model, replace(d.summary,E'\n',' ') from post_run_diagnosis d where d.session_id::text='$SID'")
EOT
if [ -n "${VERDICT:-}" ]; then PIPE=complete; else PIPE=incomplete; fi
NNN=$(printf '%03d' "$N"); FILE="automation-super-run-logs/$DIR/$NNN-$TICKET.md"
mkdir -p "automation-super-run-logs/$DIR"
{
echo "# $DIR run $NNN — $TICKET"; echo
echo "- kind: $KIND"
echo "- model (on result): ${MODEL:-<none>}"
echo "- created: $RCREATED"
echo "- result id: $RID"
echo "- ticket: https://linear.app/terminaldotshop/issue/$TICKET"
echo "- session: ${SID:-<none>}"
echo "- session: ${SESS:-<none>}"
echo "- drive job: ${DRIVE:-<none>}"
echo "- result: $RSTATUS${RFINISHED:+ at $RFINISHED}${RREASON:+ — $RREASON}"
echo "- diagnose job: ${DIAGJ:-<none>}"
echo "- diagnosis: ${VERDICT:-<none>}${ETYPE:+ ($ETYPE)}${DMODEL:+ by $DMODEL}"
[ -n "${SUMMARY:-}" ] && echo "- summary: $SUMMARY"
echo "- pipeline: $PIPE"
[ -n "$NOTE" ] && echo "- note: $NOTE"
echo; echo "Webhook/automation log:"; echo '```'
psql "$DBURL" -X -A -t -F' ' -c "select to_char(l.created_at at time zone 'UTC','HH24:MI:SS'), l.level, l.text from logs l where l.location='automation' and l.agent_id='$TICKET' order by l.id"
echo '```'
} > "$FILE"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$DIR-$NNN" "$KIND" "$MODEL" "$TICKET" "$RID" "$SID" "$RSTATUS" "$DSTATUS" "${JSTATUS:-none}" "${VERDICT:-none}" "${ETYPE:-}" "$PIPE${NOTE:+; $NOTE}" >> automation-super-run-logs/index.tsv
echo "$FILE ($KIND $PIPE)"
