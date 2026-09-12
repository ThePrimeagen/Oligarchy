#!/bin/sh
# linear-state.sh <ticket> <Needs Review|Canceled|In Progress|Done>
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ROOT="${OLIGARCHY_ROOT:?set OLIGARCHY_ROOT or run install.sh}"
TICKET="$1"; STATE="$2"
case "$STATE" in
  "Needs Review") SID=cdf3eb61-bc4b-4b61-8e47-cc2c145a6b6a ;;
  "Canceled") SID=4e654471-6d94-4ef7-aea6-586fe11c19a1 ;;
  "In Progress") SID=2a566723-82d0-40ef-ac2a-55b1811da198 ;;
  "Done") SID=c763405d-1724-401d-b6ab-9fa352172819 ;;
  *) echo "unknown state $STATE" >&2; exit 1 ;;
esac
TOKEN="$(grep '^LINEAR_API_TOKEN=' "$ROOT/.env" | cut -d= -f2- | tr -d '"'"'")"
ID=$(curl -s https://api.linear.app/graphql -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  --data "{\"query\":\"query(\$id:String!){issue(id:\$id){id}}\",\"variables\":{\"id\":\"$TICKET\"}}" | jq -r '.data.issue.id')
curl -s https://api.linear.app/graphql -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  --data "{\"query\":\"mutation(\$id:String!,\$s:String!){issueUpdate(id:\$id,input:{stateId:\$s}){success issue{identifier state{name}}}}\",\"variables\":{\"id\":\"$ID\",\"s\":\"$SID\"}}" \
  | jq -c '.data.issueUpdate | {success, ticket: .issue.identifier, state: .issue.state.name}'
