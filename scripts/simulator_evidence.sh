#!/bin/sh
# Drive the #/device-evidence page in the iOS Simulator (issues #7/#17).
#
# The Simulator removes the need for a physical iPhone for MOST of the
# evidence matrix: real iOS Safari/WebKit rendering, the service worker,
# persistent storage, the voice inventory, VoiceOver (via the Accessibility
# Inspector), and dialog-focus behavior are all faithful. What it CANNOT
# stand in for, and the exported report must say so: WebGPU/WebLLM
# performance (simulators use the Mac's GPU stack), true audio route
# changes (no Bluetooth), thermal/energy behavior, and quota pressure on
# real flash storage. Treat a simulator report as "iOS-faithful evidence,
# device-performance items still open".
#
# One-time setup (needs ~15 GB free):
#   1. Install Xcode from the App Store (or xcodes.app / developer.apple.com).
#   2. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
#   3. sudo xcodebuild -license accept
#   4. xcodebuild -downloadPlatform iOS      # the iOS Simulator runtime
#
# Usage:   ./scripts/simulator_evidence.sh [https://<mac-lan-ip>:4443]
#   With no argument it serves the production build locally over HTTPS
#   first (the PWA/service-worker checks need a secure context).

set -eu

DEVELOPER_DIR="$(xcode-select -p 2>/dev/null || true)"
if [ "$DEVELOPER_DIR" = "/Library/Developer/CommandLineTools" ] || ! xcrun simctl help >/dev/null 2>&1; then
  echo "Full Xcode is not active (found: ${DEVELOPER_DIR:-none})." >&2
  echo "Install Xcode, then run:  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  echo "and:  xcodebuild -downloadPlatform iOS" >&2
  exit 2
fi

URL="${1:-}"
SERVER_PID=""
cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if [ -z "$URL" ]; then
  if [ ! -f .local/https/server-cert.pem ]; then
    echo "No TLS leaf at .local/https/ — pass the served HTTPS URL as an argument instead." >&2
    exit 2
  fi
  echo "Building and serving the production bundle over HTTPS on :4443…"
  npm run build >/dev/null
  HOST=0.0.0.0 PORT=4443 AI_ENABLED=false \
    TLS_CERT_FILE=.local/https/server-cert.pem TLS_KEY_FILE=.local/https/server-key.pem \
    node --env-file-if-exists=.env server/server.mjs >/tmp/lumen-sim-serve.log 2>&1 &
  SERVER_PID=$!
  sleep 2
  URL="https://127.0.0.1:4443"
fi

# Pick the newest available iPhone simulator.
DEVICE=$(xcrun simctl list devices available | grep -o 'iPhone [^(]*(\([0-9A-F-]*\)' | tail -1 | grep -o '[0-9A-F-]\{36\}' || true)
if [ -z "$DEVICE" ]; then
  echo "No iPhone simulator found. Run:  xcodebuild -downloadPlatform iOS" >&2
  exit 2
fi
NAME=$(xcrun simctl list devices | grep "$DEVICE" | sed 's/ *(.*//' | head -1)
echo "Using simulator: $NAME ($DEVICE)"

xcrun simctl bootstatus "$DEVICE" -b

# Trust the local CA inside the simulator so the HTTPS page loads clean.
if [ -f .local/https/ca-cert.pem ]; then
  xcrun simctl keychain "$DEVICE" add-root-cert .local/https/ca-cert.pem \
    && echo "Local CA trusted inside the simulator." \
    || echo "WARNING: could not add the CA root — Safari will warn about the certificate." >&2
fi

open -a Simulator
xcrun simctl openurl "$DEVICE" "$URL/#/device-evidence"

cat <<GUIDE

Simulator Safari is now on the Device Evidence page.

  1. Let the automatic checks populate, then walk the manual checklist.
     Note "iOS Simulator ($NAME)" in every check's notes field.
  2. VoiceOver: Xcode → Open Developer Tool → Accessibility Inspector,
     target the simulator, and run the reader/review/dialog checks.
  3. Storage: Device → Erase All Content and Settings… tests cold-start;
     backgrounding tests the narration foreground-safety rules.
  4. Export the JSON report and paste it into issue #7. Mark the
     WebGPU/WebLLM performance and audio-routing checks as SKIPPED with
     the note "not simulator-faithful" — those still need the phone.

A dated screenshot lands next to the report:
GUIDE
SHOT="/tmp/lumen-device-evidence-simulator-$(date +%Y%m%d-%H%M%S).png"
sleep 4
xcrun simctl io "$DEVICE" screenshot "$SHOT" && echo "  $SHOT"

if [ -n "$SERVER_PID" ]; then
  echo
  echo "Serving stays up until you press Enter (finish the checklist first)."
  read -r _
fi
