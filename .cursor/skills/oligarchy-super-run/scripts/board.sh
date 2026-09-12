#!/bin/sh
# board.sh : one line per active run. One psql for the rows (do not open one per ticket).
set -u
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
cd "$ROOT"
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
[ -s "$DEST/active" ] || { echo "no active runs"; exit 0; }
VALS=$(awk -F'|' 'NF>=4{printf "%s(%s,'\''%s'\'', '\''%s'\''::uuid, '\''%s'\'')", sep, $1, $2, $3, $4; sep=","}' "$DEST/active")
[ -n "$VALS" ] || { echo "no active runs"; exit 0; }
printf '%-9s %-9s %-8s %-10s %-10s %-9s %-10s %-7s %s\n' run ticket result drive diagnose verdict session act/img since
psql "$DBURL" -X -A -t -F' ' -c "
  with a(n, dir, rid, ticket) as (values $VALS)
  select rpad(a.dir||'-'||lpad(a.n::text,3,'0'),9), rpad(a.ticket,9), rpad(r.status::text,8),
    rpad(coalesce((select j.status::text from automation_jobs j where j.result_id=r.result_id and j.action='drive'),'-'),10),
    rpad(coalesce((select j.status::text from automation_jobs j where j.result_id=r.result_id and j.action='diagnose'),'-'),10),
    rpad(coalesce((select d.verdict::text||coalesce('/'||d.error_type,'') from post_run_diagnosis d where d.session_id=r.session_id),'-'),9),
    rpad(coalesce((select s.status::text from sessions s where s.id=r.session_id),'-'),10),
    rpad(coalesce((select count(*)::text from actions a2 where a2.session_id=r.session_id),'0')||'/'||coalesce((select count(*)::text from images i join actions a2 on a2.id=i.action_id where a2.session_id=r.session_id),'0'),7),
    to_char(now()-r.created_at,'HH24:MI:SS')
  from a join test_results r on r.result_id=a.rid
  order by a.n"
SESS_TMP="${OLIGARCHY_SESSIONS_DIR:-$HOME/personal/oligarchy-tmp}"
echo "tmpfs $(df -h /tmp | awk 'NR==2{print $3}') used; avail $(free -g | awk 'NR==2{print $7}')G RAM; dirs: $(ls -d /tmp/oligarchy-* "$SESS_TMP"/oligarchy-* 2>/dev/null | wc -l); disk $(du -sh "$SESS_TMP" 2>/dev/null | cut -f1); jobs in flight: $(psql "$DBURL" -X -A -t -c "select count(*) from automation_jobs where status='running'")"
