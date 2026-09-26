#!/bin/sh
# linear-state.sh <ticket> <Needs Review|Canceled|In Progress|Done>
# The state is looked up by name on the ticket's own team: each team has its own state ids.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
TICKET="$1"; STATE="$2"
case "$STATE" in
  "Needs Review"|"Canceled"|"In Progress"|"Done") ;;
  *) echo "unknown state $STATE" >&2; exit 1 ;;
esac
TOKEN="$(grep '^LINEAR_API_TOKEN=' "$ROOT/.env" | cut -d= -f2- | tr -d '"'"'")"
gql() {
  curl -fsS https://api.linear.app/graphql -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    --data "$(jq -n --arg q "$1" --argjson v "$2" '{query: $q, variables: $v}')"
}
ISSUE=$(gql 'query($id:String!,$s:String!){issue(id:$id){id team{states(filter:{name:{eq:$s}}){nodes{id}}}}}' \
  "$(jq -n --arg id "$TICKET" --arg s "$STATE" '{id: $id, s: $s}')")
ID=$(printf '%s\n' "$ISSUE" | jq -e -r '.data.issue.id') || {
  echo "linear-state.sh: no ticket $TICKET: $ISSUE" >&2
  exit 1
}
SID=$(printf '%s\n' "$ISSUE" | jq -e -r '.data.issue.team.states.nodes[0].id') || {
  echo "linear-state.sh: $TICKET's team has no state named $STATE" >&2
  exit 1
}
UPDATED=$(gql 'mutation($id:String!,$s:String!){issueUpdate(id:$id,input:{stateId:$s}){success issue{identifier state{name}}}}' \
  "$(jq -n --arg id "$ID" --arg s "$SID" '{id: $id, s: $s}')")
printf '%s\n' "$UPDATED" | jq -e '.data.issueUpdate.success == true' >/dev/null
printf '%s\n' "$UPDATED" | jq -c '.data.issueUpdate | {success, ticket: .issue.identifier, state: .issue.state.name}'
