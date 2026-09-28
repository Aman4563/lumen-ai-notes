// Backup export and restore, encrypted export and the vault sync fold load
// together on first use, as one warm tool (issue #95): the service worker
// fetches them after the first idle so they also work offline.
export { createBackup, createRecoverySnapshot, preflightBackup } from "./backup.js";
export { decryptBackupFile, encryptBackupJson, isEncryptedBackupFile, readEncryptedHeader } from "./backupCrypto.js";
export { checkSyncHeader, foldPeerSnapshots, loadSyncBaseline, saveSyncBaseline } from "./syncVault.js";
