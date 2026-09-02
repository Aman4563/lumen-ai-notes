# Encrypted backup design — `lumen.backup.enc.v1`

Status: implemented 2026-09-02 (issue #18). This document is the mandated
design record; `src/lib/backupCrypto.js` is the implementation.

## Position

Encryption is a **pure transport wrapper** around the existing backup:
the plaintext is the exact canonical JSON string `createBackup` already
produces, and decryption feeds the unchanged `preflightBackup(string)`.
`src/lib/backup.js` is not modified — unencrypted v4 backups stay
byte-identical by construction, and the two-phase restore, integrity
digest, and v1–v4 compatibility all keep working on the decrypted text.

## Container format (binary, not JSON+base64)

```
"LUMENENC" (8 ASCII bytes)  ‖  uint32-BE header length  ‖  header JSON (UTF-8)  ‖  AES-256-GCM ciphertext
```

JSON-with-base64 was rejected: ~33% inflation pushes a 16.7 MB workspace
to ~22.3 MB of base64 inside an outer JSON envelope — colliding with the
25 MB `MAX_BACKUP_BYTES` cap — and materializes several extra
notebook-sized strings on exactly the mobile-Safari string-amplification
path `backup.js` warns about. The binary container adds only ~34 MB of
transient allocations over the measured ~94 MB RSS growth, inside the
220 MB gate in `scripts/backup_memory_audit.mjs`, and downloads as a
Blob assembled from `[prefixBytes, ciphertext]` with no concatenation.

Header fields (canonical JSON; unknown fields and unknown format ids are
rejected):

- `format`: `"lumen.backup.enc.v1"`
- `kdf`: `{ name: "PBKDF2", hash: "SHA-256", iterations, salt (base64) }`
- `cipher`: `{ name: "AES-GCM", iv (base64), tagLength: 128 }`
- `compression`: `"none"` (forward-compatibility slot)
- `exportedAt`: ISO timestamp (shown before the password prompt)

## Cryptography

- **KDF**: WebCrypto PBKDF2-HMAC-SHA256, **600,000 iterations** — the
  OWASP Password Storage Cheat Sheet's current recommendation
  (<https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>).
  The password is NFC-normalized before key import so composed and
  decomposed Unicode spellings derive the same key.
- **Salt**: 16 random bytes per export (16–32 accepted on import). A fresh
  salt means a fresh key per export, so IV reuse is structurally
  impossible.
- **Cipher**: AES-256-GCM, 12-byte random IV, 128-bit tag.
- **AAD**: the exact file prefix bytes (magic ‖ length ‖ header) **as
  written to and read from the file — never re-serialized**. Any header
  tamper (salt, iterations, format id) fails authentication. Rebuilding
  the AAD from a re-stringified parsed header is the classic bug in this
  design and is explicitly tested against.
- **No plaintext checksum in the clear header**: a deterministic digest of
  the plaintext would be a password-guess confirmation oracle. The GCM tag
  covers transport integrity; the inner v4 `integrity.digest` is verified
  after decryption by the unchanged preflight.

## Attacker-controlled header bounds (checked before any key derivation)

- `100,000 ≤ iterations ≤ 10,000,000` (floor guards downgrade bugs; the
  ceiling prevents a hostile file from hanging the tab in PBKDF2).
- `1 ≤ headerLen ≤ 16,384` and `8 + 4 + headerLen + 16 ≤ file.size`,
  else `MALFORMED_ENC_HEADER`.
- `file.size ≤ MAX_BACKUP_BYTES + 64 KiB` else `TOO_LARGE`, checked
  before reading the file into memory.

## Error contract (reuses `BackupValidationError`)

- `WRONG_PASSWORD` — GCM auth failure. Wrong password and corruption are
  cryptographically indistinguishable under GCM; the message says both.
- `MALFORMED_ENC_HEADER`, `UNSUPPORTED_ENC_FORMAT`, `TOO_LARGE`.
- `CRYPTO_UNAVAILABLE` — no `crypto.subtle` / insecure context. There is
  **no weak-crypto fallback**: on LAN HTTP the encrypted-export toggle is
  disabled with an explanation instead.

## UX decisions

- Import sniffs the first 8 bytes: the magic routes to a password prompt
  (the stashed `File` and the dialog survive a wrong password for retry);
  anything else takes today's plain-JSON path with zero changes.
- Export: an optional password field; when set (and in a secure context)
  the download is `lumen-notes-backup-YYYY-MM-DD.lumenc`
  (`application/octet-stream`) instead of `.json`.
- The export copy states plainly: a forgotten password is permanent data
  loss — there is no escrow by design.
- The mid-restore recovery download **stays plaintext v4 in v1**:
  recovery must survive a forgotten password. The restore confirm dialog
  says so. Encrypting the recovery file under the same password is the
  documented follow-up.

## Relationship to sync (issue #14)

This container is the transport primitive for the file-based encrypted
sync design (`docs/SYNC_DESIGN.md`): per-device state files in this
format, merged through `mergeProfileVersions`.
