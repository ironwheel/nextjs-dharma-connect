#!/bin/sh
# Entry point for the systemd unit. Configuration comes from the unit's EnvironmentFile.
# When CRONITOR_MONITOR is set and the cronitor CLI is installed, the run is reported to it.
set -eu
cd "$(dirname "$0")/.."

if [ -n "${CRONITOR_MONITOR:-}" ] && command -v cronitor >/dev/null 2>&1; then
  exec cronitor exec "$CRONITOR_MONITOR" "node src/cli.ts $*"
fi
exec node src/cli.ts "$@"
