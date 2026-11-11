const POLYNOMIAL = 0xedb88320;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) === 1 ? POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * IEEE 802.3 CRC-32.
 *
 * Pass a previous result as `seed` to continue a checksum across several
 * buffers: `crc32(b, crc32(a)) === crc32(concat(a, b))`.
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const index = (crc ^ (bytes[i] ?? 0)) & 0xff;
    crc = ((TABLE[index] ?? 0) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
