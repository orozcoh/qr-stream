import qrcode from 'qrcode-generator';
import { qrCapacity } from '../core/capacity';

export { qrCapacity } from '../core/capacity';

export interface QrMatrix {
  version: number;
  /** Modules per side, excluding the quiet zone. */
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

/**
 * Render one packet as a QR matrix, forcing the version.
 *
 * The version must be pinned: a QR that changes size mid-stream makes the
 * receiving camera re-hunt scale and position on every frame, which costs more
 * throughput than a denser code ever buys back.
 *
 * The encoder's byte conversion is overridden only for the duration of this
 * call. Doing it at module load would silently change `qrcode-generator` for
 * every other consumer in the same page.
 */
export function packetToMatrix(packet: Uint8Array, version: number): QrMatrix {
  const capacity = qrCapacity(version);
  if (packet.length > capacity) {
    throw new RangeError(`packet is ${packet.length} bytes; version ${version}-L holds ${capacity}`);
  }

  const knownGood = qrcode.stringToBytes;
  qrcode.stringToBytes = (text: string): number[] => {
    const out = new Array<number>(text.length);
    for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  };

  let qr: ReturnType<typeof qrcode>;
  try {
    qr = qrcode(version as Parameters<typeof qrcode>[0], 'L');
    qr.addData(toLatin1(packet), 'Byte');
    qr.make();
  } catch (error) {
    throw new RangeError(
      `packet does not fit QR version ${version}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    qrcode.stringToBytes = knownGood;
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
