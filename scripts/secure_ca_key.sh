#!/bin/sh
# Move the Lumen local CA private key to offline custody (issue #8).
#
# Why this is safe today: the HTTPS serve reads only TLS_CERT_FILE/
# TLS_KEY_FILE (.local/https/server-cert.pem / server-key.pem). The CA key
# signs NEW leaf certificates only, and the current leaf is valid until
# 2027-10-03 — the key is operationally unneeded until renewal. Keeping it
# on the serving machine is pure risk: anyone who copies it can mint
# certificates every paired device trusts.
#
# Usage:   ./scripts/secure_ca_key.sh /Volumes/YOUR-USB-STICK
#
# What it does, in order, refusing to proceed on any failure:
#   1. sanity-checks the leaf certificate has >90 days of validity left;
#   2. copies ca-key.pem and ca-cert.srl to <destination>/lumen-ca/;
#   3. byte-compares the copies against the originals;
#   4. removes the local originals;
#   5. boots the server once on loopback to prove the serve still works.
#
# Renewal (before 2027-10-03): bring the USB back, restore the two files to
# .local/https/, re-run the leaf issuance from AI_SERVER.md, then run this
# script again. The public ca-cert.pem stays on the machine — it is not a
# secret and the app serves it for device trust installation.

set -eu

DEST_ROOT="${1:-}"
KEY=".local/https/ca-key.pem"
SRL=".local/https/ca-cert.srl"
LEAF=".local/https/server-cert.pem"

if [ -z "$DEST_ROOT" ]; then
  echo "Usage: $0 <destination, e.g. /Volumes/YOUR-USB-STICK>" >&2
  exit 2
fi
if [ ! -d "$DEST_ROOT" ]; then
  echo "Destination $DEST_ROOT does not exist or is not a directory." >&2
  exit 2
fi
if [ ! -f "$KEY" ]; then
  echo "No CA key at $KEY — nothing to move (already secured?)." >&2
  exit 0
fi

# 1. Leaf must outlive the move by a comfortable margin.
if ! openssl x509 -in "$LEAF" -noout -checkend 7776000; then
  echo "The server certificate expires within 90 days. Renew the leaf FIRST" >&2
  echo "(you need the CA key for that), then re-run this script." >&2
  exit 1
fi
echo "Leaf certificate has >90 days of validity — safe to move the CA key."

# 2. Copy.
DEST="$DEST_ROOT/lumen-ca"
mkdir -p "$DEST"
cp "$KEY" "$DEST/ca-key.pem"
[ -f "$SRL" ] && cp "$SRL" "$DEST/ca-cert.srl"

# 3. Verify byte-identical before deleting anything.
cmp -s "$KEY" "$DEST/ca-key.pem" || { echo "Copy verification FAILED — nothing was deleted." >&2; exit 1; }
if [ -f "$SRL" ]; then
  cmp -s "$SRL" "$DEST/ca-cert.srl" || { echo "Serial-file copy verification FAILED — nothing was deleted." >&2; exit 1; }
fi
chmod 600 "$DEST/ca-key.pem"
echo "Copied and verified at $DEST."

# 4. Remove local originals (rm -P overwrites before unlink on macOS).
rm -P "$KEY" 2>/dev/null || rm "$KEY"
[ -f "$SRL" ] && (rm -P "$SRL" 2>/dev/null || rm "$SRL")
echo "Local CA key removed."

# 5. Prove the HTTPS serve still boots without it.
BOOT_LOG=$(mktemp)
HOST=127.0.0.1 PORT=4299 AI_ENABLED=false node --env-file-if-exists=.env server/server.mjs >"$BOOT_LOG" 2>&1 &
BOOT_PID=$!
BOOT_OK=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if grep -q "server_started" "$BOOT_LOG"; then BOOT_OK=1; break; fi
  sleep 1
done
kill "$BOOT_PID" 2>/dev/null || true
if [ "$BOOT_OK" = "1" ]; then
  echo "Server boot check passed — HTTPS serving is unaffected."
  echo "Done. Store the USB somewhere offline; renewal is due before 2027-10-03."
else
  echo "WARNING: the server did not report started within 10s. Inspect:" >&2
  cat "$BOOT_LOG" >&2
  echo "The CA key is safe at $DEST — restore it with: cp $DEST/ca-key.pem $KEY" >&2
  exit 1
fi
