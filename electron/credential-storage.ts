export interface EncryptedStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
}

/** Electron's Linux basic_text fallback does not protect remembered secrets. */
export function encryptedStorageAvailable(storage: EncryptedStorage, platform = process.platform) {
  if (!storage.isEncryptionAvailable()) return false;
  if (platform !== 'linux') return true;
  return ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
    storage.getSelectedStorageBackend?.() ?? 'unknown',
  );
}
