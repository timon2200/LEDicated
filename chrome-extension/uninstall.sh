#!/usr/bin/env bash
# uninstall.sh - Remove YouTube Plus Local Companion from macOS

set -e

PLIST_FILE="$HOME/Library/LaunchAgents/com.youtubeplus.companion.plist"
APP_DIR="/Applications/YouTube Plus.app"

echo "Removing YouTube Plus Companion LaunchAgent..."
if [ -f "$PLIST_FILE" ]; then
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    rm -f "$PLIST_FILE"
fi

if [ -d "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
fi

echo "✅ YouTube Plus Companion uninstalled."
