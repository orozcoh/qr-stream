import { describe, expect, test } from 'vitest';
import { WrongKeyError, decryptBytes, encryptBytes } from '../src/core/crypto';

const ITERATIONS = 1000;

describe('encryption', () => {
  test('round-trips a payload', async () => {
    const plain = Uint8Array.from({ length: 1024 }, (_, i) => i & 0xff);
    const sealed = await encryptBytes(plain, 'correct horse', ITERATIONS);
    const opened = await decryptBytes(sealed.ciphertext, 'correct horse', sealed.salt, sealed.nonce, sealed.iterations);
    expect(Array.from(opened)).toEqual(Array.from(plain));
  });

  test('ciphertext is longer than plaintext by the GCM tag', async () => {
    const plain = new Uint8Array(32);
    const sealed = await encryptBytes(plain, 'k', ITERATIONS);
    expect(sealed.ciphertext.length).toBe(plain.length + 16);
    expect(sealed.salt.length).toBe(16);
    expect(sealed.nonce.length).toBe(12);
  });

  test('wrong passphrase raises WrongKeyError', async () => {
    const sealed = await encryptBytes(new Uint8Array([1, 2, 3]), 'right', ITERATIONS);
    await expect(
      decryptBytes(sealed.ciphertext, 'wrong', sealed.salt, sealed.nonce, sealed.iterations),
    ).rejects.toBeInstanceOf(WrongKeyError);
  });

  test('corrupted ciphertext raises WrongKeyError, same as a wrong key', async () => {
    const sealed = await encryptBytes(new Uint8Array([1, 2, 3]), 'right', ITERATIONS);
    const corrupted = new Uint8Array(sealed.ciphertext);
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
    await expect(
      decryptBytes(corrupted, 'right', sealed.salt, sealed.nonce, sealed.iterations),
    ).rejects.toBeInstanceOf(WrongKeyError);
  });

  test('passphrase is trimmed and NFC-normalised', async () => {
    const sealed = await encryptBytes(new Uint8Array([9, 9]), '  pass  ', ITERATIONS);
    const opened = await decryptBytes(sealed.ciphertext, 'pass', sealed.salt, sealed.nonce, sealed.iterations);
    expect(Array.from(opened)).toEqual([9, 9]);
  });

  test('two encryptions of the same input differ', async () => {
    const plain = new Uint8Array([1, 2, 3]);
    const a = await encryptBytes(plain, 'k', ITERATIONS);
    const b = await encryptBytes(plain, 'k', ITERATIONS);
    expect(Array.from(a.ciphertext)).not.toEqual(Array.from(b.ciphertext));
  });
});
