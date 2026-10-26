#!/usr/bin/env bash
# install.sh - Install and start YouTube Plus Local Companion on macOS

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$LAUNCH_AGENTS_DIR/com.youtubeplus.companion.plist"
LOG_DIR="$HOME/.youtube-plus"
PYTHON_BIN="$(which python3 || echo '/usr/bin/python3')"

mkdir -p "$LAUNCH_AGENTS_DIR"
mkdir -p "$LOG_DIR"

echo "⚡ Setting up YouTube Plus Companion Server..."

# Check yt-dlp & ffmpeg
if ! command -v yt-dlp &> /dev/null; then
    echo "⚠️  yt-dlp is not in PATH. Checking homebrew..."
    if [ -f "/opt/homebrew/bin/yt-dlp" ]; then
        echo "Found /opt/homebrew/bin/yt-dlp"
    fi
fi

# Stop existing LaunchAgent if active
if launchctl list | grep -q "com.youtubeplus.companion"; then
    echo "Stopping existing instance..."
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
fi

# Create LaunchAgent plist
cat << EOF > "$PLIST_FILE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.youtubeplus.companion</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON_BIN</string>
        <string>$PROJECT_DIR/server.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/companion.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/companion.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin</string>
    </dict>
</dict>
</plist>
EOF

# Load and start LaunchAgent
launchctl load "$PLIST_FILE"

# Create cute macOS Application bundle in Applications folder
APP_DIR="/Applications/YouTube Plus.app"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Generate ICNS or copy icons if available
if [ -f "$PROJECT_DIR/icons/icon-128.png" ]; then
    cp "$PROJECT_DIR/icons/icon-128.png" "$APP_DIR/Contents/Resources/AppIcon.png"
fi

cat << 'EOF' > "$APP_DIR/Contents/MacOS/YouTube Plus"
#!/usr/bin/env bash
STATUS=$(curl -s -m 1 http://127.0.0.1:5000/health || echo "offline")

if [[ "$STATUS" == *"online"* ]]; then
    ACTION=$(osascript -e 'display dialog "⚡ YouTube Plus Companion is active and running at http://127.0.0.1:5000\n\nyt-dlp + ffmpeg ready for 4K & MP3 downloads." buttons {"Open Downloads", "Restart Server", "OK"} default button "OK" with title "YouTube Plus"')
    if [[ "$ACTION" == *"Open Downloads"* ]]; then
        open "$HOME/Downloads"
    elif [[ "$ACTION" == *"Restart Server"* ]]; then
        launchctl unload "$HOME/Library/LaunchAgents/com.youtubeplus.companion.plist" 2>/dev/null
        launchctl load "$HOME/Library/LaunchAgents/com.youtubeplus.companion.plist"
        osascript -e 'display notification "YouTube Plus Companion restarted." with title "YouTube Plus"'
    fi
else
    launchctl load "$HOME/Library/LaunchAgents/com.youtubeplus.companion.plist" 2>/dev/null
    osascript -e 'display dialog "Starting YouTube Plus Companion Server..." buttons {"OK"} default button "OK" with title "YouTube Plus"'
fi
EOF

chmod +x "$APP_DIR/Contents/MacOS/YouTube Plus"

cat << EOF > "$APP_DIR/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>YouTube Plus</string>
    <key>CFBundleIdentifier</key>
    <string>com.youtubeplus.companion</string>
    <key>CFBundleName</key>
    <string>YouTube Plus</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
EOF

echo ""
echo "====================================================="
echo "✅ YouTube Plus Companion installed successfully!"
echo "🚀 Autostart: ENABLED (Starts automatically on Mac login)"
echo "📱 App Created: /Applications/YouTube Plus.app"
echo "🌐 Server URL: http://127.0.0.1:5000"
echo "====================================================="
