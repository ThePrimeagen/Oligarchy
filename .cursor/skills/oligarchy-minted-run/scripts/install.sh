#!/bin/sh
# install.sh : the super-run helpers, installed for the minted fleet (four qemu servers with one
# job and one data dir each, one automation client with four). Copies the scripts from the
# super-run skill into /tmp/mintedrun and writes an env that names this fleet's ports and dirs.
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
SUPER="$HERE/../../oligarchy-super-run/scripts"
ROOT="${OLIGARCHY_ROOT:-$(cd "$HERE/../../../.." && pwd)}"
DEST="${SUPER_RUN_DIR:-/tmp/mintedrun}"
DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
mkdir -p "$DEST" "$DATA/qemu-a" "$DATA/qemu-b" "$DATA/qemu-c" "$DATA/qemu-d"
cat > "$DEST/env" <<EOF
export OLIGARCHY_ROOT='$ROOT'
export SUPER_RUN_DIR='$DEST'
export SUPER_RUN_PORTS='55555|55341|55342|55343|55344|52224|54321'
export SUPER_RUN_SERVER_URL='${SUPER_RUN_SERVER_URL:-https://oligarchy-server.trm.sh}'
export SUPER_RUN_ISO='${SUPER_RUN_ISO:-https://iso.omarchy.org/omarchy-4.0.2.iso}'
export SUPER_RUN_VERSION='${SUPER_RUN_VERSION:-4.0.2}'
export SUPER_RUN_TEST='${SUPER_RUN_TEST:-lock-screen}'
export OLIGARCHY_SESSIONS_DIR='${OLIGARCHY_SESSIONS_DIR:-$HOME/personal/oligarchy-tmp}'
export OLIGARCHY_DATA_ROOT='$DATA'
EOF
for f in board.sh new.sh retire.sh record.sh cleanup.sh linear-state.sh status.sh tick.sh reset.sh; do
  cp "$SUPER/$f" "$DEST/$f"
  chmod +x "$DEST/$f"
done
touch "$DEST/active"
[ -f "$DEST/next" ] || echo 1 > "$DEST/next"
echo "installed helpers in $DEST (OLIGARCHY_ROOT=$ROOT, data dirs under $DATA)"
echo "source $DEST/env and set DBURL from $ROOT/.env before ticks"
