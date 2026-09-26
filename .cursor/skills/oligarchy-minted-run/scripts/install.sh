#!/bin/sh
# install.sh : the super-run helpers, installed for the minted fleet (four qemu servers with one
# job and one data dir each, one automation client with four). Copies the scripts from the
# super-run skill into /tmp/mintedrun, writes an env that names this fleet's ports and dirs, and
# seeds each data dir's iso cache from an existing one so four servers do not each download the
# ISO. Never touches a minted disk (<iso>.qcow2, <iso>.OVMF_VARS.fd).
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
SUPER="$HERE/../../oligarchy-super-run/scripts"
ROOT="${OLIGARCHY_ROOT:-$(cd "$HERE/../../../.." && pwd)}"
DEST="${SUPER_RUN_DIR:-/tmp/mintedrun}"
DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
ISO="${SUPER_RUN_ISO:-https://iso.omarchy.org/omarchy-4.0.2.iso}"
# The cache the default qemu server (no --data-dir) downloads into; any dir laid out like it works.
CACHE="${SUPER_RUN_ISO_CACHE:-$HOME/.oligarchy/isos}"
mkdir -p "$DEST" "$DATA/qemu-a" "$DATA/qemu-b" "$DATA/qemu-c" "$DATA/qemu-d"
cat > "$DEST/env" <<EOF
export OLIGARCHY_ROOT='$ROOT'
export SUPER_RUN_DIR='$DEST'
export SUPER_RUN_PORTS='55555|55341|55342|55343|55344|52224|54321'
export SUPER_RUN_SERVER_URL='${SUPER_RUN_SERVER_URL:-https://oligarchy-server.trm.sh}'
export SUPER_RUN_ISO='$ISO'
export SUPER_RUN_VERSION='${SUPER_RUN_VERSION:-4.0.2}'
export SUPER_RUN_TEST='${SUPER_RUN_TEST:-lock-screen}'
export SUPER_RUN_COUNT='${SUPER_RUN_COUNT:-100}'
export OLIGARCHY_SESSIONS_DIR='${OLIGARCHY_SESSIONS_DIR:-$HOME/personal/oligarchy-tmp}'
export OLIGARCHY_DATA_ROOT='$DATA'
export SUPER_RUN_ISO_CACHE='$CACHE'
EOF
for f in board.sh new.sh retire.sh record.sh cleanup.sh linear-state.sh status.sh tick.sh reset.sh; do
  cp "$SUPER/$f" "$DEST/$f"
  chmod +x "$DEST/$f"
done
touch "$DEST/active"
[ -f "$DEST/next" ] || echo 1 > "$DEST/next"

# The iso cache names a download after its url with every character a file system could object
# to replaced by `_` (src/qemu/iso.ts cacheFileName), and records it in manifest.json as
# { "<file>": { status: "cached", cachedAt, lastUsedAt } }. A dir holding both is a server that
# already downloaded the ISO.
FILE=$(printf '%s' "$ISO" | tr '<>:"/\\|?*' '_________')
if [ -f "$CACHE/$FILE" ]; then
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  for s in a b c d; do
    isos="$DATA/qemu-$s/isos"
    mkdir -p "$isos"
    if [ -f "$isos/$FILE" ]; then
      echo "qemu-$s: has the ISO"
      continue
    fi
    # reflink shares blocks on btrfs/xfs and falls back to a copy elsewhere; the partial name is
    # the cache's own convention, so a copy cut short is never taken for a whole ISO.
    cp --reflink=auto "$CACHE/$FILE" "$isos/$FILE.partial-seed"
    mv "$isos/$FILE.partial-seed" "$isos/$FILE"
    if [ -f "$isos/manifest.json" ]; then
      jq --arg f "$FILE" --arg now "$NOW" \
        '.[$f] = { status: "cached", cachedAt: $now, lastUsedAt: $now }' \
        "$isos/manifest.json" > "$isos/manifest.json.partial-seed"
    else
      jq -n --arg f "$FILE" --arg now "$NOW" \
        '{ ($f): { status: "cached", cachedAt: $now, lastUsedAt: $now } }' \
        > "$isos/manifest.json.partial-seed"
    fi
    mv "$isos/manifest.json.partial-seed" "$isos/manifest.json"
    echo "qemu-$s: seeded the ISO from $CACHE"
  done
else
  echo "no $FILE in $CACHE; each qemu server downloads the ISO on its first start"
fi
echo "installed helpers in $DEST (OLIGARCHY_ROOT=$ROOT, data dirs under $DATA)"
echo "source $DEST/env and set DBURL from $ROOT/.env before ticks"
