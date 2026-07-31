const test = require('node:test');
const assert = require('node:assert/strict');
const { decryptSafeValue, encryptSafeValue } = require('../../src/main/secure-config.helpers');

test('sensitive config ciphertext is verified before plaintext migration can finish', () => {
  const adapter = {
    encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^protected:/, ''),
  };
  const ciphertext = encryptSafeValue(adapter, 'refresh-secret');
  assert.match(ciphertext, /^enc:/);
  assert.doesNotMatch(ciphertext, /refresh-secret/);
  assert.equal(decryptSafeValue(adapter, ciphertext), 'refresh-secret');
});

test('sensitive config refuses an encryption adapter that fails round-trip verification', () => {
  const broken = {
    encryptString: () => Buffer.from('wrong', 'utf8'),
    decryptString: () => 'different',
  };
  assert.throws(() => encryptSafeValue(broken, 'secret'), /round-trip verification failed/);
});
