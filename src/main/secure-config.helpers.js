function decryptSafeValue(safeStorage, value) {
  if (!String(value || '').startsWith('enc:')) throw new Error('invalid encrypted value');
  return safeStorage.decryptString(Buffer.from(String(value).slice(4), 'base64'));
}

function encryptSafeValue(safeStorage, value) {
  const plaintext = String(value);
  const encrypted = `enc:${safeStorage.encryptString(plaintext).toString('base64')}`;
  if (decryptSafeValue(safeStorage, encrypted) !== plaintext) {
    throw new Error('safeStorage round-trip verification failed');
  }
  return encrypted;
}

module.exports = { decryptSafeValue, encryptSafeValue };
