#!/bin/sh
# clear.sh : everything an earlier batch left behind, before the next one starts. Refuses while a
# fleet port is bound (stop the fleet first).
#  - local data: session dirs, both data dirs (ISO, minted disks), the old fleet's dirs, the ISO
#    cache, driver debug logs;
#  - the database: jobs, sessions and results still pending/running are aborted, and so is a run
#    that had one of those results (a finished run stays pending: nothing closes it), every setup
#    lock is deleted, and fleet rows with no heartbeat are forgotten;
#  - Linear: OligarchyTest tickets still in Backlog, Automation Needed, In Progress or In Review
#    are Canceled, and so is a Needs Review ticket whose result has no finished diagnose (the
#    board watch would queue one mid-batch).
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
[ -n "${DBURL:-}" ] || { echo "DBURL is required" >&2; exit 1; }
cd "$ROOT"
SOCKETS=$(ss -ltn) || { echo "clear.sh: cannot inspect fleet ports" >&2; exit 1; }
if printf '%s\n' "$SOCKETS" | grep -qE ':(55555|55332|55333|52222|52223|54321) '; then
  echo "clear.sh: a fleet port is bound; fleet.sh stop first" >&2
  exit 1
fi

DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
SESS="${OLIGARCHY_SESSIONS_DIR:-$HOME/personal/oligarchy-tmp}"
CACHE="${SUPER_RUN_ISO_CACHE:-$HOME/.oligarchy/isos}"
mkdir -p "$SESS"
# Everything inside is the qemu servers' TMPDIR; the directory itself must be one of ours.
case "$(cd "$SESS" && pwd -P)" in
  / | "$HOME" | "$(pwd -P)")
    echo "clear.sh: refusing to empty $SESS" >&2
    exit 1
    ;;
esac
find "$SESS" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
rm -rf "$DATA/qemu-1" "$DATA/qemu-2" "$DATA/qemu-server-4" "$DATA/qemu-server-3" "$CACHE"
rm -f /tmp/oligarchy-driver-*.jsonl
find /tmp -maxdepth 1 -type d -regextype posix-extended \
  -regex '/tmp/oligarchy-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' -exec rm -rf {} +
mkdir -p "$DATA/qemu-1/isos" "$DATA/qemu-2/isos"
echo "clear.sh: local data cleared"

REASON="cleared before a super-run: left in flight by an earlier batch"
# A run is aborted only with a result aborted here: nothing closes a finished run, which stays
# pending. The fleet's own rows go whatever their heartbeat (the fleet was just stopped); another
# fleet's rows go only once silent.
psql "$DBURL" -X -v ON_ERROR_STOP=1 -v reason="$REASON" -q -A -t <<'SQL'
begin;
with x as (update automation_jobs set status = 'aborted', reason = :'reason', finished_at = now() where status in ('pending', 'running') returning 1) select 'jobs aborted: ' || count(*) from x;
with x as (update sessions set status = 'aborted', reason = :'reason', ended_at = now() where status in ('running', 'downloading') returning 1) select 'sessions aborted: ' || count(*) from x;
with aborted as (update test_results set status = 'aborted', reason = :'reason', finished_at = now() where status in ('pending', 'running') returning run_id),
  x as (update test_runs set status = 'aborted', reason = :'reason', ended_at = now() where status in ('pending', 'running') and id in (select run_id from aborted) returning 1)
  select 'results aborted: ' || (select count(*) from aborted) || '; runs aborted: ' || count(*) from x;
with x as (delete from setup_requests returning 1) select 'setup locks deleted: ' || count(*) from x;
with x as (delete from servers where name in ('qemu-1', 'qemu-2', 'automation-client-2a', 'automation-client-2b') or heartbeat_at is null or heartbeat_at < now() - interval '45 seconds' returning 1) select 'fleet rows deleted: ' || count(*) from x;
commit;
SQL

DIAGNOSED=$(psql "$DBURL" -X -A -t -c "select r.linear_id from test_results r join automation_jobs j on j.result_id = r.result_id where j.action = 'diagnose' and j.status = 'succeeded' and r.linear_id is not null")
LINEAR_API_TOKEN="$(grep '^LINEAR_API_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'")" \
LINEAR_TEAM="$(grep '^LINEAR_TEAM=' .env | cut -d= -f2- | tr -d '"'"'")" \
DIAGNOSED="$DIAGNOSED" python3 - <<'PY'
import json, os, urllib.request

token, team = os.environ["LINEAR_API_TOKEN"], os.environ["LINEAR_TEAM"]
diagnosed = set(os.environ["DIAGNOSED"].split())

def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request("https://api.linear.app/graphql", data=body,
        headers={"Authorization": token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    if data.get("errors"):
        raise SystemExit(f"clear.sh: linear: {data['errors']}")
    return data["data"]

states = gql("query($t:String!){teams(filter:{name:{eq:$t}}){nodes{states{nodes{id name}}}}}", {"t": team})
teams = states["teams"]["nodes"]
if not teams:
    raise SystemExit(f"clear.sh: linear: no team named {team}")
by_name = {s["name"]: s["id"] for s in teams[0]["states"]["nodes"]}
open_states = ["Backlog", "Automation Needed", "In Progress", "In Review", "Needs Review"]
tickets, after = [], None
while True:
    page = gql("query($t:String!,$s:[String!],$a:String){issues(first:100,after:$a,filter:{team:{name:{eq:$t}},state:{name:{in:$s}}}){nodes{id identifier state{name}} pageInfo{hasNextPage endCursor}}}",
               {"t": team, "s": open_states, "a": after})["issues"]
    tickets += page["nodes"]
    if not page["pageInfo"]["hasNextPage"]:
        break
    after = page["pageInfo"]["endCursor"]
canceled = []
for t in tickets:
    if t["state"]["name"] == "Needs Review" and t["identifier"] in diagnosed:
        continue
    done = gql("mutation($id:String!,$s:String!){issueUpdate(id:$id,input:{stateId:$s}){success}}",
               {"id": t["id"], "s": by_name["Canceled"]})
    if not done["issueUpdate"]["success"]:
        raise SystemExit(f"clear.sh: cancel {t['identifier']} failed")
    canceled.append(f"{t['identifier']}({t['state']['name']})")
print(f"clear.sh: linear tickets canceled: {len(canceled)}{': ' + ' '.join(canceled) if canceled else ''}")
PY
