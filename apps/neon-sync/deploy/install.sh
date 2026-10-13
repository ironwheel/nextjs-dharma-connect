#!/usr/bin/env bash
# Deploys neon-sync from this checkout to an Amazon Linux 2023 host over SSH.
#
#   apps/neon-sync/deploy/install.sh [-i ssh-key] [--enable] user@host
#
# Packages the app with its locked production dependencies, copies it to
# /opt/neon-sync, installs Node.js 24 if needed, and installs the systemd
# service + timer. Rerun to upgrade. The timer is only enabled with --enable,
# and only once /etc/neon-sync/neon-sync.env has been filled in.
set -euo pipefail

REMOTE_DIR=/opt/neon-sync
ENV_FILE=/etc/neon-sync/neon-sync.env
SSH_OPTS=(-o ConnectTimeout=15)
ENABLE=false
TARGET=

usage() { sed -n '2,10s/^# \{0,1\}//p' "$0"; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    -i) SSH_OPTS+=(-i "$2"); shift 2 ;;
    --enable) ENABLE=true; shift ;;
    -h|--help) usage ;;
    -*) echo "Unknown option: $1" >&2; usage ;;
    *) TARGET=$1; shift ;;
  esac
done
[ -n "$TARGET" ] || usage

APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
REPO_ROOT=$(cd "$APP_DIR/../.." && pwd)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "==> Packaging $(git -C "$REPO_ROOT" describe --always --dirty)"
(cd "$REPO_ROOT" && pnpm --filter neon-sync deploy --prod --legacy "$STAGE/app" >/dev/null)
git -C "$REPO_ROOT" describe --always --dirty > "$STAGE/app/REVISION"

echo "==> Copying to $TARGET:$REMOTE_DIR"
# Swap the whole directory so a release never mixes old and new files,
# waiting out any run in progress first.
COPYFILE_DISABLE=1 tar -C "$STAGE/app" -czf - . | ssh "${SSH_OPTS[@]}" "$TARGET" "
  set -e
  sudo rm -rf $REMOTE_DIR.new && sudo mkdir -p $REMOTE_DIR.new
  sudo tar -xzf - -C $REMOTE_DIR.new --no-same-owner --warning=no-unknown-keyword
  while systemctl is-active -q neon-sync.service; do sleep 5; done
  sudo rm -rf $REMOTE_DIR.old
  if [ -d $REMOTE_DIR ]; then sudo mv $REMOTE_DIR $REMOTE_DIR.old; fi
  sudo mv $REMOTE_DIR.new $REMOTE_DIR && sudo rm -rf $REMOTE_DIR.old"

echo "==> Configuring host"
ssh "${SSH_OPTS[@]}" "$TARGET" \
  REMOTE_DIR="$REMOTE_DIR" ENV_FILE="$ENV_FILE" ENABLE="$ENABLE" 'bash -s' <<'REMOTE'
set -euo pipefail
if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != 24 ]; then
  sudo dnf install -y -q nodejs24
  # AL2023 installs versioned binaries; point "node" at 24.
  if [ -x /usr/bin/node-24 ]; then sudo alternatives --set node /usr/bin/node-24 2>/dev/null || sudo ln -sf /usr/bin/node-24 /usr/bin/node; fi
fi
echo "node $(node --version)"

user=$(id -un)
for unit in neon-sync.service neon-sync.timer; do
  sed -e "s|@APP_DIR@|$REMOTE_DIR|g" -e "s|@USER@|$user|g" "$REMOTE_DIR/deploy/$unit" \
    | sudo tee "/etc/systemd/system/$unit" >/dev/null
done
sudo systemctl daemon-reload

if ! sudo test -f "$ENV_FILE"; then
  sudo install -d -m 700 "$(dirname "$ENV_FILE")"
  sudo install -m 600 "$REMOTE_DIR/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE from the example; fill it in before enabling the timer."
  exit 0
fi

if [ "$ENABLE" = true ]; then
  sudo systemctl enable --now neon-sync.timer
fi
echo "timer: $(systemctl is-enabled neon-sync.timer 2>/dev/null || true), next: $(systemctl show neon-sync.timer -p NextElapseUSecRealtime --value)"
REMOTE

echo "==> Done. Dry run on the host with:"
echo "    sudo systemd-run --uid=\$(id -un) --pipe --wait -p EnvironmentFile=$ENV_FILE $REMOTE_DIR/bin/run.sh --dry-run"
