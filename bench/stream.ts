import { FountainDecoder } from '../src/core/fountain.js';
import { decodePacket } from '../src/core/packet.js';
import { createQrStreamWriter } from '../src/core/writer.js';
import { incompressibleBytes, MIB } from './fixtures.js';

/**
 * A 1 MiB stream as a receiver would actually see it.
 *
 * Every fourth systematic frame is dropped and repair symbols fill the gaps
 * until the fountain decoder closes. Feeding all k systematic symbols would
 * measure the trivial copy path and would hide peeling/elimination cost, which
 * is where the receiver spends its time on a lossy camera link.
 */
export interface StreamFixture {
  k: number;
  blockSize: number;
  sessionId: number;
  /** Accepted wire packets in arrival order; systematic gaps are intentional. */
  packets: Uint8Array[];
  symbolsToComplete: number;
}

let cached: Promise<StreamFixture> | null = null;

export function streamFixture(): Promise<StreamFixture> {
  cached ??= build();
  return cached;
}

async function build(): Promise<StreamFixture> {
  const data = incompressibleBytes(MIB, 0x5eed);
  const writer = await createQrStreamWriter(data, {
    filename: 'bench.bin',
    preset: 'fast',
    sessionId: 42,
  });

  const decoder = new FountainDecoder(writer.k, writer.blockSize, writer.sessionId);
  const iterator = writer.packets();
  const packets: Uint8Array[] = [];
  let produced = 0;

  try {
    while (!decoder.isComplete) {
      if (produced > writer.k * 4) throw new Error('fountain stream did not converge');
      const { value, done } = await iterator.next();
      if (done || value === undefined) throw new Error('packet stream ended early');

      const packet = decodePacket(value);
      if (packet === null) throw new Error('writer produced an invalid packet');
      produced += 1;

      // Drop a quarter of the systematic symbols to force peeling and, when it
      // stalls, Gaussian elimination.
      if (packet.symbolIdx < writer.k && packet.symbolIdx % 4 === 0) continue;

      packets.push(value);
      decoder.add(packet.symbolIdx, packet.payload);
    }
  } finally {
    await iterator.return?.(undefined);
  }

  return {
    k: writer.k,
    blockSize: writer.blockSize,
    sessionId: writer.sessionId,
    packets,
    symbolsToComplete: packets.length,
  };
}
