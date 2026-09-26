#!/bin/sh
# download.sh <iso-url> : one copy of the ISO into each data dir's iso cache, both at once, under
# the cache's file name with a manifest entry marking it cached, so neither qemu server downloads
# a third. A partial name is renamed only after curl exits 0.
set -eu
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
[ -f "$DEST/env" ] && . "$DEST/env"
ISO="${1:?usage: download.sh <iso-url>}"
DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
FILE=$(printf '%s' "$ISO" | tr '<>:"/\\|?*' '_________')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
one() {
  isos="$DATA/qemu-$1/isos"
  mkdir -p "$isos"
  curl -fsSL --retry 3 -o "$isos/$FILE.partial-seed" "$ISO"
  mv "$isos/$FILE.partial-seed" "$isos/$FILE"
  jq -n --arg f "$FILE" --arg now "$NOW" \
    '{ ($f): { status: "cached", cachedAt: $now, lastUsedAt: $now } }' > "$isos/manifest.json"
  echo "qemu-$1: downloaded $ISO ($(wc -c < "$isos/$FILE") bytes)"
}
one 1 &
A=$!
one 2 &
B=$!
wait "$A"
wait "$B"
