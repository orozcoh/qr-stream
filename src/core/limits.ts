import { QrStreamError } from './errors.js';
import { MAX_DECODED_BYTES, MAX_INPUT_BYTES, MAX_WIRE_BYTES, type ReaderLimits, type TransferLimits } from './types.js';

/** AES-GCM authentication tag appended to an encrypted wire body. */
export const GCM_TAG_BYTES = 16;

/**
 * Upper bound on the encoded metadata block plus its varint length prefix.
 * Shared by the writer's defensive payload check and the reader's plausibility
 * bound so both sides budget the same overhead.
 */
export const MAX_META_OVERHEAD = 256;

/** Internal: the validated bounds a writer uses after `resolveTransferLimits`. */
interface ResolvedTransferLimits {
  maxWireBytes: number;
  maxInputBytes: number;
}

/** Internal: the validated bounds a reader uses after `resolveReaderLimits`. */
interface ResolvedReaderLimits {
  maxWireBytes: number;
  maxDecodedBytes: number;
}

/** A limit may only tighten the default; anything else is a host bug. */
function resolveLimit(name: string, value: number | undefined, fallback: number, ceiling: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > ceiling) {
    throw new QrStreamError('INVALID_ARGUMENT', `${name} must be a positive integer no greater than ${ceiling}`, {
      details: { name, value, ceiling },
    });
  }
  return value;
}

export function resolveTransferLimits(limits: TransferLimits = {}): ResolvedTransferLimits {
  return {
    maxWireBytes: resolveLimit('maxWireBytes', limits.maxWireBytes, MAX_WIRE_BYTES, MAX_WIRE_BYTES),
    maxInputBytes: resolveLimit('maxInputBytes', limits.maxInputBytes, MAX_INPUT_BYTES, MAX_INPUT_BYTES),
  };
}

export function resolveReaderLimits(limits: ReaderLimits = {}): ResolvedReaderLimits {
  return {
    maxWireBytes: resolveLimit('maxWireBytes', limits.maxWireBytes, MAX_WIRE_BYTES, MAX_WIRE_BYTES),
    maxDecodedBytes: resolveLimit('maxDecodedBytes', limits.maxDecodedBytes, MAX_DECODED_BYTES, MAX_DECODED_BYTES),
  };
}
