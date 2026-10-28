#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="LEDicatedBar"
BUNDLE_ID="hr.studiovarazdin.ledicated.menubar"
BUILD_DIR="$SCRIPT_DIR/build"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
USER_APPS_DIR="$HOME/Applications"
INSTALLED_APP="$USER_APPS_DIR/$APP_NAME.app"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$BUNDLE_ID.plist"

echo "🔨 Kompajliranje nativne macOS Menu Bar aplikacije ($APP_NAME)..."
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cp "$SCRIPT_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"

swiftc -O \
  -parse-as-library \
  -target arm64-apple-macosx14.0 \
  -framework AppKit \
  -framework SwiftUI \
  -framework Network \
  "$SCRIPT_DIR/LEDicatedMenuBar.swift" \
  -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

codesign --force --deep --sign - "$APP_BUNDLE"

mkdir -p "$USER_APPS_DIR"
rm -rf "$INSTALLED_APP"
cp -R "$APP_BUNDLE" "$INSTALLED_APP"
codesign --force --deep --sign - "$INSTALLED_APP"

if [[ "${1:-}" == "--install" ]]; then
  echo "🚀 Postavljanje automatskog pokretanja pri paljenju MacBooka (LaunchAgent)..."
  mkdir -p "$LAUNCH_AGENTS_DIR"
  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$BUNDLE_ID</string>
    <key>ProgramArguments</key>
    <array>
        <string>$INSTALLED_APP/Contents/MacOS/$APP_NAME</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>/tmp/ledicated-menubar.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/ledicated-menubar.err.log</string>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)/$BUNDLE_ID" 2>/dev/null || true
  killall "$APP_NAME" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  launchctl kickstart -k "gui/$(id -u)/$BUNDLE_ID"
  echo "✅ $APP_NAME je instaliran u $INSTALLED_APP i pokrenut u macOS Menu Baru!"
else
  echo "✅ Build gotov: $APP_BUNDLE (instalirano i u $INSTALLED_APP)"
fi
