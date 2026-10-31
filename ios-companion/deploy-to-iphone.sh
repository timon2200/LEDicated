#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/build/LEDicatedPad.app"
DEVICE_ID="2E70D7B0-8AF2-5050-B0E4-07AF16F1DD29"
SIGN_ID="0F6AC04D47D5127530AD87970274CA1A750DBFA1"
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"

collect_swift_files() {
  find "$ROOT_DIR/LEDicatedPad" -type f -name "*.swift" | sort
}

compute_sources_hash() {
  collect_swift_files | xargs cat | shasum -a 256 | awk '{print $1}'
}

typecheck_only() {
  echo "🔍 Typechecking LEDicatedPad Swift modules (arm64-apple-ios17.0)..."
  local files=()
  while IFS= read -r file; do
    files+=("$file")
  done < <(collect_swift_files)

  xcrun --sdk iphoneos swiftc -target arm64-apple-ios17.0 -typecheck "${files[@]}"
  echo "✅ Typecheck passed (${#files[@]} files)!"
}

compile_binary() {
  mkdir -p "$APP_DIR"
  local files=()
  while IFS= read -r file; do
    files+=("$file")
  done < <(collect_swift_files)

  echo "⚡ [1/4] Compiling native arm64 LEDicatedPad (${#files[@]} Swift files)..."
  xcrun --sdk iphoneos swiftc -target arm64-apple-ios17.0 -O \
    "${files[@]}" \
    -o "$APP_DIR/LEDicatedPad"

  xcrun --sdk iphoneos appintentsmetadataprocessor \
    --output "$APP_DIR" \
    --target-triple arm64-apple-ios17.0 \
    --binary-file "$APP_DIR/LEDicatedPad" \
    --module-name LEDicatedPad \
    --sdk-root "$(xcrun --sdk iphoneos --show-sdk-path)" \
    --xcode-version 16.0 \
    --source-files "${files[@]}" 2>/dev/null || true
}

build_and_deploy() {
  compile_binary

  PROFILE_FILE="$(ls -t "$PROFILE_DIR"/*.mobileprovision | head -n 1)"
  cp "$PROFILE_FILE" "$APP_DIR/embedded.mobileprovision"
  security cms -D -i "$PROFILE_FILE" > /tmp/ledicated-profile.plist
  /usr/libexec/PlistBuddy -x -c "Print :Entitlements" /tmp/ledicated-profile.plist > /tmp/LEDicatedPad.entitlements

  echo "🔐 [2/4] Code-signing LEDicatedPad.app..."
  codesign --force --sign "$SIGN_ID" --entitlements /tmp/LEDicatedPad.entitlements "$APP_DIR"

  echo "📡 [3/4] Installing onto iPhone over Wi-Fi / USB ($DEVICE_ID)..."
  xcrun devicectl device install app --device "$DEVICE_ID" "$APP_DIR"

  echo "🚀 [4/4] Launching LEDicated Pad on iPhone..."
  xcrun devicectl device process launch --terminate-existing --device "$DEVICE_ID" com.studiovarazdin.ledicatedpad || true
  echo "✅ Live update complete at $(date '+%H:%M:%S')!"
}

case "${1:-}" in
  --check)
    typecheck_only
    ;;
  --build-only)
    compile_binary
    echo "✅ Binary compiled at $APP_DIR/LEDicatedPad"
    ;;
  --watch)
    echo "👀 Watching $ROOT_DIR/LEDicatedPad/**/*.swift for changes (Wi-Fi / USB live deploy)..."
    build_and_deploy
    LAST_HASH="$(compute_sources_hash)"
    while true; do
      sleep 1
      NEW_HASH="$(compute_sources_hash)"
      if [[ "$NEW_HASH" != "$LAST_HASH" ]]; then
        LAST_HASH="$NEW_HASH"
        echo ""
        echo "🔄 Swift file change detected — pushing wireless update to iPhone..."
        build_and_deploy || echo "⚠️ Build/deploy failed; waiting for next save..."
      fi
    done
    ;;
  *)
    build_and_deploy
    ;;
esac
