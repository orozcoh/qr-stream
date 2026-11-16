/**
 * Every branchable failure the library can originate carries one of these
 * codes. Messages stay human-readable and may change; `code` and `recovery`
 * are the stable API.
 */
export type QrStreamErrorCode =
  | 'INPUT_TOO_LARGE'
  | 'WIRE_TOO_LARGE'
  | 'DECODED_TOO_LARGE'
  | 'UNSUPPORTED_RUNTIME'
  | 'INVALID_ARGUMENT'
  | 'INVALID_QR_VERSION'
  | 'INVALID_SCALE'
  | 'PACKET_TOO_LARGE'
  | 'INVALID_PACKET'
  | 'INVALID_METADATA'
  | 'UNSUPPORTED_VERSION'
  | 'COMPRESSION_FAILED'
  | 'DECOMPRESSION_FAILED'
  | 'CRYPTO_FAILED'
  | 'WRONG_PASSPHRASE'
  | 'PAYLOAD_CORRUPT'
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_IN_USE'
  | 'CAMERA_UNAVAILABLE'
  | 'CAMERA_CONSTRAINTS_FAILED'
  | 'TORCH_UNSUPPORTED'
  | 'DECODER_FAILED'
  | 'RENDER_FAILED';

/** What the host can usefully do next. Also part of the stable API. */
export type QrStreamRecovery =
  | 'retry'
  | 'retry-passphrase'
  | 'rescan'
  | 'change-input'
  | 'change-camera'
  | 'grant-permission'
  | 'upgrade-browser'
  | 'upgrade-library'
  | 'none';

export interface QrStreamErrorOptions {
  cause?: unknown;
  details?: Readonly<Record<string, unknown>>;
  recovery?: QrStreamRecovery;
}

type PayloadScope = 'input' | 'wire' | 'decoded';

type CameraErrorCode = Extract<
  QrStreamErrorCode,
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_IN_USE'
  | 'CAMERA_UNAVAILABLE'
  | 'CAMERA_CONSTRAINTS_FAILED'
  | 'TORCH_UNSUPPORTED'
  | 'DECODER_FAILED'
>;

/** Only attach `cause` when the caller supplied one, so `in` stays honest. */
function errorInit(options: QrStreamErrorOptions): ErrorOptions | undefined {
  return options.cause === undefined ? undefined : { cause: options.cause };
}

export class QrStreamError extends Error {
  readonly code: QrStreamErrorCode;
  readonly recovery: QrStreamRecovery;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: QrStreamErrorCode, message: string, options: QrStreamErrorOptions = {}) {
    super(message, errorInit(options));
    this.name = 'QrStreamError';
    this.code = code;
    this.recovery = options.recovery ?? 'none';
    if (options.details !== undefined) this.details = Object.freeze({ ...options.details });
  }
}

const PAYLOAD_CODES: Record<PayloadScope, QrStreamErrorCode> = {
  input: 'INPUT_TOO_LARGE',
  wire: 'WIRE_TOO_LARGE',
  decoded: 'DECODED_TOO_LARGE',
};

const PAYLOAD_RECOVERY: Record<PayloadScope, QrStreamRecovery> = {
  input: 'change-input',
  wire: 'change-input',
  decoded: 'none',
};

function oversizedMessage(scope: PayloadScope, actual: number, limit: number): string {
  if (scope === 'input') return `input is ${actual} bytes; the limit is ${limit}`;
  if (scope === 'wire') return `compressed payload is ${actual} bytes; the wire limit is ${limit}`;
  return `decoded payload exceeds the size limit (${limit} bytes)`;
}

export class PayloadTooLargeError extends QrStreamError {
  readonly scope: PayloadScope;
  readonly actual: number;
  readonly limit: number;

  constructor(
    scope: PayloadScope,
    actual: number,
    limit: number,
    message: string = oversizedMessage(scope, actual, limit),
  ) {
    super(PAYLOAD_CODES[scope], message, {
      details: { scope, actual, limit },
      recovery: PAYLOAD_RECOVERY[scope],
    });
    this.name = 'PayloadTooLargeError';
    this.scope = scope;
    this.actual = actual;
    this.limit = limit;
  }
}

/** AES-GCM authentication failed: wrong passphrase or damaged payload. */
export class WrongKeyError extends QrStreamError {
  constructor(message = 'The passphrase does not match this transfer, or the payload is damaged.') {
    super('WRONG_PASSPHRASE', message, { recovery: 'retry-passphrase' });
    this.name = 'WrongKeyError';
  }
}

function cameraRecovery(code: CameraErrorCode): QrStreamRecovery {
  if (code === 'CAMERA_PERMISSION_DENIED') return 'grant-permission';
  if (code === 'TORCH_UNSUPPORTED') return 'none';
  if (code === 'DECODER_FAILED') return 'retry';
  return 'change-camera';
}

export class CameraError extends QrStreamError {
  constructor(code: CameraErrorCode, message: string, options: QrStreamErrorOptions = {}) {
    super(code, message, { ...options, recovery: options.recovery ?? cameraRecovery(code) });
    this.name = 'CameraError';
  }
}

export class DecoderError extends QrStreamError {
  constructor(message: string, options: QrStreamErrorOptions = {}) {
    super('DECODER_FAILED', message, { ...options, recovery: options.recovery ?? 'retry' });
    this.name = 'DecoderError';
  }
}

export class RenderError extends QrStreamError {
  constructor(message: string, options: QrStreamErrorOptions = {}) {
    super('RENDER_FAILED', message, { ...options, recovery: options.recovery ?? 'none' });
    this.name = 'RenderError';
  }
}

export function isQrStreamError(value: unknown): value is QrStreamError {
  return value instanceof QrStreamError;
}
