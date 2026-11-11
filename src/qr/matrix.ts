import qrcode from 'qrcode-generator';

/**
 * Byte-mode capacity at ECC level L, indexed by QR version (1-40).
 * Source: the QR specification's character capacity table.
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

export interface QrMatrix {
  version: number;
  /** Modules per side, including the quiet zone. */
  size: number;
  get(x: number, y: number): boolean;
}

/** Packets are arbitrary bytes; byte mode reads one char code per byte. */
function toLatin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i] as number);
  }
  return text;
}

qrcode.stringToBytes = (text: string): number[] => {
  const out = new Array<number>(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/**
 * Render one packet as a QR matrix, forcing the version.
 *
 * The version must be pinned: a QR that changes size mid-stream makes the
 * receiving camera re-hunt scale and position on every frame, which costs more
 * throughput than a denser code ever buys back.
 */
export function packetToMatrix(packet: Uint8Array, version: number): QrMatrix {
  const capacity = qrCapacity(version);
  if (packet.length > capacity) {
    throw new RangeError(`packet is ${packet.length} bytes; version ${version}-L holds ${capacity}`);
  }

  const qr = qrcode(version, 'L');
  qr.addData(toLatin1(packet), 'Byte');

  try {
    qr.make();
  } catch (error) {
    throw new RangeError(
      `packet does not fit QR version ${version}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const size = qr.getModuleCount();
  if (size !== version * 4 + 17) {
    throw new Error(`encoder produced version ${(size - 17) / 4}, expected ${version}`);
  }

  return {
    version,
    size,
    get(x: number, y: number): boolean {
      if (x < 0 || y < 0 || x >= size || y >= size) return false;
      return qr.isDark(y, x);
    },
  };
}
