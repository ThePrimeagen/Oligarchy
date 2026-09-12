#!/bin/sh
# status.sh <result_id> : everything the database knows about one test result.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
RID="$1"
psql "$DBURL" -X -P pager=off -c "
select 'result' as row, r.linear_id as ticket, r.status::text, coalesce(r.model,'') as model, coalesce(r.session_id::text,'') as session, coalesce(r.reason,'') as reason, to_char(r.created_at at time zone 'UTC','HH24:MI:SS') as created, coalesce(to_char(r.finished_at at time zone 'UTC','HH24:MI:SS'),'') as finished
from test_results r where r.result_id='$RID';
select j.action::text as job, j.status::text, coalesce(to_char(j.started_at at time zone 'UTC','HH24:MI:SS'),'') as started, coalesce(to_char(j.finished_at at time zone 'UTC','HH24:MI:SS'),'') as finished, coalesce(j.reason,'') as reason
from automation_jobs j where j.result_id='$RID' order by j.created_at;
select s.status::text as session_status, coalesce(s.reason,'') as reason, to_char(s.started_at at time zone 'UTC','HH24:MI:SS') as started, coalesce(to_char(s.ended_at at time zone 'UTC','HH24:MI:SS'),'') as ended,
  (select count(*) from actions a where a.session_id=s.id) as actions, (select count(*) from images i join actions a on a.id=i.action_id where a.session_id=s.id) as images
from sessions s join test_results r on r.session_id=s.id where r.result_id='$RID';
select d.verdict::text as diagnosis, coalesce(d.error_type,'') as error_type, d.model, left(d.summary,300) as summary
from post_run_diagnosis d join test_results r on r.session_id=d.session_id where r.result_id='$RID';
select to_char(l.created_at at time zone 'UTC','HH24:MI:SS') as at, l.level::text, l.text from logs l where l.location='automation' and l.agent_id=(select linear_id from test_results where result_id='$RID') order by l.id;
"
