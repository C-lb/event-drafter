#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH=$(cd "$(dirname "$0")/.." && pwd)
NODE_PATH=$(command -v node)
LABEL="com.event-drafter.worker"
PLIST_TEMPLATE="$PROJECT_PATH/launchd/$LABEL.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -f "$PLIST_TEMPLATE" ]; then
  echo "template not found: $PLIST_TEMPLATE" >&2
  exit 1
fi

echo "Building worker..."
( cd "$PROJECT_PATH" && npm -w @event-drafter/worker run build )

echo "Installing $PLIST_DEST"
sed -e "s|__NODE_PATH__|$NODE_PATH|g" -e "s|__PROJECT_PATH__|$PROJECT_PATH|g" "$PLIST_TEMPLATE" > "$PLIST_DEST"

echo "Loading launch agent..."
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || launchctl load "$PLIST_DEST"

echo "Done. Worker will auto-start on login."
echo "  - Stop:      launchctl bootout gui/$(id -u)/$LABEL"
echo "  - Logs:      tail -f $PROJECT_PATH/data/worker.{out,err}.log"
