/**
 * Byte-mode capacity at ECC level L, indexed by QR version (1-40).
 * Source: the QR specification's character capacity table.
 *
 * Lives in the core so the codec never has to import the QR encoder: a reader
 * that only reassembles packets should not pull in a QR library.
 */
const CAPACITY_L: readonly number[] = [
  17, 32, 53, 78, 106, 134, 154, 192, 230, 271,
  321, 367, 425, 458, 520, 586, 644, 718, 792, 858,
  929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732,
  1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953,
];

export function qrCapacity(version: number): number {
  const capacity = CAPACITY_L[version - 1];
  if (capacity === undefined) throw new RangeError(`QR version out of range: ${version}`);
  return capacity;
}

/** Largest capacity any supported version offers, used to sanity-check peers. */
export const MAX_FRAME_PAYLOAD = 2953;
