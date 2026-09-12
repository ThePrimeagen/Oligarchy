#!/bin/sh
# install.sh : copy helper scripts to /tmp/superrun and write env.
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT="${OLIGARCHY_ROOT:-$(cd "$HERE/../../../.." && pwd)}"
DEST="${SUPER_RUN_DIR:-/tmp/superrun}"
mkdir -p "$DEST"
cat > "$DEST/env" <<EOF
export OLIGARCHY_ROOT='$ROOT'
export SUPER_RUN_DIR='$DEST'
export SUPER_RUN_SERVER_URL='${SUPER_RUN_SERVER_URL:-https://oligarchy-server.trm.sh}'
export SUPER_RUN_ISO='${SUPER_RUN_ISO:-https://iso.omarchy.org/omarchy-4.0.2.iso}'
export SUPER_RUN_VERSION='${SUPER_RUN_VERSION:-4.0.2}'
export SUPER_RUN_TEST='${SUPER_RUN_TEST:-lock-screen}'
EOF
for f in board.sh new.sh retire.sh record.sh cleanup.sh linear-state.sh status.sh; do
  cp "$HERE/$f" "$DEST/$f"
  chmod +x "$DEST/$f"
done
touch "$DEST/active"
echo "installed helpers in $DEST (OLIGARCHY_ROOT=$ROOT)"
echo "source $DEST/env and set DBURL from $ROOT/.env before ticks"
