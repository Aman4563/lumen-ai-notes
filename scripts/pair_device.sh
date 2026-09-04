#!/bin/sh
# Pair a phone/tablet with one camera scan — no code to find or type.
#
# Mints a single-use five-minute pairing ticket from the serving machine
# (only loopback or an already-paired browser may mint), builds the pairing
# link, and shows it as a QR code in Preview. Scanning it pairs the device
# for 30 days. The typed AI_PAIRING_CODE keeps working as the fallback.
#
# Usage:  ./scripts/pair_device.sh [host] [port]
#         defaults: the Mac's .local hostname, port 4194

set -eu

HOST="${1:-$(scutil --get LocalHostName 2>/dev/null | tr '[:upper:]' '[:lower:]').local}"
PORT="${2:-4194}"
CA=".local/https/ca-cert.pem"

MINT=$(curl -s --cacert "$CA" -X POST "https://127.0.0.1:$PORT/api/auth/pair/ticket" -H "Origin: https://127.0.0.1:$PORT")
TICKET=$(printf '%s' "$MINT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ticket',''))" 2>/dev/null || true)
if [ -z "$TICKET" ]; then
  echo "Could not mint a pairing ticket. Is the server running with AI_AUTH=pairing?" >&2
  printf '%s\n' "$MINT" >&2
  exit 1
fi

URL="https://$HOST:$PORT/#/pair?ticket=$TICKET"
echo "Pairing link (single use, valid 5 minutes):"
echo "  $URL"

QR="/tmp/lumen-pair-qr.png"
if python3 - "$URL" "$QR" <<'PY' 2>/dev/null
import sys
import qrcode
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=14, border=3)
qr.add_data(sys.argv[1])
qr.make(fit=True)
qr.make_image(fill_color="black", back_color="white").save(sys.argv[2])
PY
then
  open "$QR"
  echo "QR opened in Preview — scan it with the phone camera."
else
  echo "(python3 qrcode module unavailable — open the link above on the device manually.)"
fi
