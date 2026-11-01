import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptedStorageAvailable } from '../electron/credential-storage';

test('remembered secrets require a real Linux keyring and honor OS encryption availability', () => {
  for (const backend of ['basic_text', 'unknown', ''])
    assert.equal(
      encryptedStorageAvailable(
        { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend },
        'linux',
      ),
      false,
    );
  assert.equal(encryptedStorageAvailable({ isEncryptionAvailable: () => true }, 'linux'), false);
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])
    assert.equal(
      encryptedStorageAvailable(
        { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend },
        'linux',
      ),
      true,
    );
  for (const platform of ['win32', 'darwin', 'linux'] as const)
    assert.equal(
      encryptedStorageAvailable({ isEncryptionAvailable: () => false }, platform),
      false,
    );
  for (const platform of ['win32', 'darwin'] as const)
    assert.equal(encryptedStorageAvailable({ isEncryptionAvailable: () => true }, platform), true);
});
