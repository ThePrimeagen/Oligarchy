#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${CF_TOKEN:-}" ] || [ -z "${CF_ACC:-}" ]; then
  echo "tunnel: CF_TOKEN and CF_ACC are required" >&2
  exit 1
fi

export CLOUDFLARE_API_TOKEN="$CF_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACC"

NS="c57f718566014dcbbc7928cf179c539a"
PORT="${1:-42069}"
LOG="$(mktemp)"

npx wrangler tunnel quick-start "http://127.0.0.1:${PORT}" >"$LOG" 2>&1 &
pid=$!
tail -f "$LOG" &
tail_pid=$!
cleanup() {
  kill "$pid" "$tail_pid" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT INT TERM

url=""
for _ in $(seq 1 90); do
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  if [ -n "$url" ]; then
    break
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "tunnel: wrangler exited before publishing a url" >&2
    exit 1
  fi
  sleep 1
done

if [ -z "$url" ]; then
  echo "tunnel: no trycloudflare url" >&2
  exit 1
fi

code="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACC}/storage/kv/namespaces/${NS}/values/url" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  --data-binary "$url")"
if [ "$code" != "200" ]; then
  echo "tunnel: failed to register origin (${code})" >&2
  exit 1
fi

echo "tunnel: runner.oligarchy.trm.sh -> ${url}"
wait "$pid"
