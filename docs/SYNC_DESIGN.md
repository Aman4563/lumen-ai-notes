# SYNC-001 design — encrypted, account-free, file-based cross-device sync

Status: design accepted 2026-09-02; **v1 implemented 2026-09-02** (issue
#14) — container v2 (`vaultId`/`deviceId` in the authenticated header),
durable device identity, vault membership, the deviceId-sorted peer fold
with baseline reset on replacement, the out-of-store baseline database, and
the manual export/import UI (§9.3's mobile-Safari fallback is the v1 UI on
every platform). Folder-watching via the File System Access API and the
relay remain future work; COLLAB-001 stays out of scope.

## 1. Goals and non-goals

- Preserve local-first, offline, account-free operation. No server is
  required; a future relay is an optimization, not a dependency.
- Sync must reuse the merge machinery that already carries cross-tab
  convergence — no second merge algorithm.
- Collaboration (shared workspaces, presence, other people's edits) is out of
  scope until sync is proven.

## 2. Foundations already in the codebase

- `src/lib/profileSync.js` — three-way, record-aware `mergeProfileVersions`:
  id unions, edit-beats-delete, deterministic tie-breaks (A+B = B+A),
  recovered-conflict clones, review-attempt replay through `gradeReviewItem`
  (now under the merged profile's scheduler), session-counter delta
  reconciliation, capacity/rollover conflict records.
- Generation fencing: `prepareProfileReplacement` + `isProfileReplacementNewer`
  make reset/restore authoritative instead of resurrectable.
- Tombstone unions: `deletedCustomDocumentIds` (cap 1,000, sorted union) and
  `aiTutorHistoryTombstones` carry deletions between writers.
- `src/lib/boardSync.js` — `mergeBoardVersions` for `board:*` records.
- `src/lib/backup.js` — the canonical v4 envelope (LUMEN-CANONICAL-JSON-V1,
  SHA-256 envelope-core integrity, 25 MiB cap).
- **Shipped transport primitive (issue #18)**: the `lumen.backup.enc.v1`
  binary container in `src/lib/backupCrypto.js` — PBKDF2-HMAC-SHA256 at
  600k iterations, AES-256-GCM, raw-prefix-bytes AAD, typed
  `WRONG_PASSWORD`, fail-closed without WebCrypto, ~284 bytes of overhead on
  the maximum workspace. Sync files ARE this container; no second format.

## 3. Sync envelope

A sync state file is the encrypted container over the exact canonical v4
backup JSON (profile + `board:*` records). Two additive header fields are
reserved for sync (the v1 header rejects unknown fields, so this bumps the
container to `lumen.backup.enc.v2` when implemented): `vaultId` (random id
shared by all devices in the vault) and `deviceId` (the writer). Both live in
the authenticated header, so a file cannot be silently re-attributed.

Key handling: one passphrase per vault, entered on each device, never stored.
Wrong passphrase and corruption remain indistinguishable under GCM — the
combined honest error message shipped in #18 carries over. No key escrow; a
forgotten passphrase means starting a new vault from any one device's data.

## 4. Device identity

- Durable `deviceId = createId()` persisted at `localStorage["lumen-device-id-v1"]`
  — distinct from the per-tab ephemeral `writerId`.
- Sync exports set `syncMeta.writerId = deviceId` (200-char cap holds).
- The vault baseline (the last successful merge result) is stored OUTSIDE the
  profile (its own IndexedDB record), so sync state never churns profile
  merges, normalizers, backups, or `audit:sync`.

## 5. Topology: one file per writer

```
<chosen-folder>/lumen-sync/<vaultId>/<deviceId>.lumenc
```

Each device writes ONLY its own file — cloud providers (iCloud Drive,
Syncthing, any synced directory, or manual USB transfer) never see two
writers on one file, which sidesteps their conflict-copy behavior entirely.

- **Export cycle**: merge-then-export with `advanceRevision: false` (the same
  read-only snapshot discipline as today's backup export), encrypt, replace
  own file atomically.
- **Import cycle**: scan the vault folder, decrypt peer files, fold each in
  deviceId-sorted order as `merged = mergeProfileVersions(baseline,
  accumulatedLocal, peerRemote)` — the peer file is always the `remote`
  argument (the merged profile spreads `remote`, so argument order is
  load-bearing). `board:*` records fold per key through `mergeBoardVersions`.
  On completion the merge result becomes the new baseline and the device
  re-exports its own file.

## 6. Cross-device merge semantics

- **Generation fencing**: differing `syncMeta.generation` short-circuits to
  the `isProfileReplacementNewer` winner (`replacementApplied`), so a
  reset/restore on one device propagates instead of being resurrected. On
  `replacementApplied`, the importer MUST reset its stored baseline to the
  merge result — folding later peers against the stale baseline would
  resurrect pre-replacement records.
- Tombstone unions carry deletions; capacity overflows surface as the
  existing conflict records; concurrent edits produce recovered-copy clones,
  never silent loss.
- The FSRS scheduler flag rides the merged settings, and attempt replay runs
  under it (already shipped in PR #26), so two devices reconcile identically.

## 7. Future relay server (explicitly out of scope)

A relay adds only transport and freshness: a dumb store of encrypted blobs
keyed by `<vaultId>/<deviceId>`, quota-limited, with no ability to read,
merge, or re-attribute files (the header is authenticated). Neither the
envelope nor the merge changes. Account systems, sharing, and presence stay
in COLLAB-001 behind this gate.

## 8. Threat model summary

Protected: file contents and header integrity (AES-256-GCM + AAD) against a
curious or compromised storage provider; silent re-attribution; header
tampering; downgrade of KDF cost below the floor. Not protected: traffic
analysis of file sizes/timestamps by the storage provider; a device that is
itself compromised; a weak vault passphrase (PBKDF2 raises cost but cannot
rescue "123456"); loss of all devices plus the passphrase (no escrow, by
design).

## 9. Open questions before implementation

1. Container v2 header fields (`vaultId`, `deviceId`) — additive bump with
   the same raw-prefix AAD discipline and explicit rejection of v1-unknown
   fields.
2. Baseline compaction: when peers disappear (device retired), how long their
   tombstoned files remain folded before pruning.
3. Mobile Safari file-system access: the File System Access API is not
   available; the fallback is manual export/import of the same files, which
   the current backup UI already models.
