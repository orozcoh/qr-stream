/** Raised whenever AES-GCM authentication fails — a wrong key or a damaged payload. */
export class WrongKeyError extends Error {
  constructor(message = 'The passphrase does not match this transfer, or the payload is damaged.') {
    super(message);
    this.name = 'WrongKeyError';
  }
}

export const DEFAULT_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;

/** Spoken passphrases arrive with stray whitespace and inconsistent Unicode forms. */
function normalize(passphrase: string): string {
  return passphrase.normalize('NFKC').trim();
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalize(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt the whole compressed payload, once.
 *
 * Per-block encryption is not an option: a repair symbol is the XOR of several
 * ciphertext blocks, so the fountain decoder has to work on ciphertext and
 * decryption must happen after reconstruction.
 */
export async function encryptBytes(
  plain: Uint8Array,
  passphrase: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; nonce: Uint8Array; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, plain as BufferSource),
  );
  return { ciphertext, salt, nonce, iterations };
}

export async function decryptBytes(
  ciphertext: Uint8Array,
  passphrase: string,
  salt: Uint8Array,
  nonce: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    throw new WrongKeyError();
  }
}
