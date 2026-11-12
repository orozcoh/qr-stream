/** Raised whenever AES-GCM authentication fails — a wrong key or a damaged payload. */
export class WrongKeyError extends Error {
  constructor(message = 'The passphrase does not match this transfer, or the payload is damaged.') {
    super(message);
    this.name = 'WrongKeyError';
  }
}

export const DEFAULT_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;

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

export interface EncryptOptions {
  /** Reuse a salt generated before the metadata block was built. */
  salt?: Uint8Array;
  /** Reuse a nonce generated before the metadata block was built. */
  nonce?: Uint8Array;
  /** Metadata bytes that must be authenticated with the ciphertext. */
  additionalData?: Uint8Array;
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
  options: EncryptOptions = {},
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; nonce: Uint8Array; iterations: number }> {
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = options.nonce ?? crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await deriveKey(passphrase, salt, iterations);
  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: nonce as BufferSource,
    ...(options.additionalData ? { additionalData: options.additionalData as BufferSource } : {}),
  };
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(params, key, plain as BufferSource));
  return { ciphertext, salt, nonce, iterations };
}

export async function decryptBytes(
  ciphertext: Uint8Array,
  passphrase: string,
  salt: Uint8Array,
  nonce: Uint8Array,
  iterations: number,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || iterations < 1) {
    throw new WrongKeyError();
  }
  try {
    const key = await deriveKey(passphrase, salt, iterations);
    const params: AesGcmParams = {
      name: 'AES-GCM',
      iv: nonce as BufferSource,
      ...(additionalData ? { additionalData: additionalData as BufferSource } : {}),
    };
    const plain = await crypto.subtle.decrypt(params, key, ciphertext as BufferSource);
    return new Uint8Array(plain);
  } catch {
    throw new WrongKeyError();
  }
}
