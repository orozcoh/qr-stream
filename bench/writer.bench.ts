import { Bench } from 'tinybench';
import { encodeSymbol } from '../src/core/fountain.js';
import { createQrStreamWriter } from '../src/core/writer.js';
import { compressibleJson, incompressibleBytes, MIB } from './fixtures.js';
import { measureArrayBufferMibAsync } from './memory.js';
import { constantMetric, runAndCollect, type BenchMetric, type MetricSpec } from './util.js';

const PASSPHRASE = 'correct horse battery staple';
const SESSION = 42;
/** `fast` preset: QR version 20 at ECC-L, minus the packet framing. */
const BLOCK_SIZE = 838;

export async function runWriterBench(): Promise<BenchMetric[]> {
  const json = compressibleJson(MIB);
  const random = incompressibleBytes(MIB);

  // Fast scenarios: createQrStreamWriter is a promise but completes in
  // milliseconds, so a short time budget still yields dozens of samples.
  const fast = new Bench({ name: 'writer-fast', time: 800, iterations: 8, warmupTime: 200 });
  fast.add(
    'writer.json.plain',
    () => createQrStreamWriter(json, { filename: 'bench.json', preset: 'fast', sessionId: SESSION }),
    { async: true },
  );
  fast.add(
    'writer.random.plain',
    () => createQrStreamWriter(random, { filename: 'bench.bin', preset: 'fast', sessionId: SESSION }),
    { async: true },
  );

  // A repair symbol XORs a pseudorandom subset of the blocks, so it is the
  // expensive half of packet generation. Systematic symbols are a memcpy.
  const blocks: Uint8Array[] = [];
  for (let i = 0; i * BLOCK_SIZE < random.length; i += 1) {
    const block = new Uint8Array(BLOCK_SIZE);
    block.set(random.subarray(i * BLOCK_SIZE, Math.min((i + 1) * BLOCK_SIZE, random.length)));
    blocks.push(block);
  }
  fast.add('writer.random.encodeRepair', () => encodeSymbol(blocks, SESSION, blocks.length + 1000));

  const fastSpecs: MetricSpec[] = [
    {
      id: 'writer.json.plain',
      group: 'writer',
      description: 'gzip + SHA-256 + block split, 1 MiB compressible JSON, no passphrase',
      unit: 'ms',
    },
    {
      id: 'writer.random.plain',
      group: 'writer',
      description: 'gzip attempt + SHA-256 + block split, 1 MiB incompressible data',
      unit: 'ms',
    },
    {
      id: 'writer.random.encodeRepair',
      group: 'writer',
      description: 'encode one repair symbol for the 1 MiB / fast-preset stream',
      unit: 'ms',
    },
  ];
  const metrics = await runAndCollect(fast, fastSpecs);

  // PBKDF2 at 600k iterations dominates an encrypted prepare (~75 ms here),
  // so it needs a longer budget than the plain path.
  const slow = new Bench({ name: 'writer-encrypted', time: 2500, iterations: 5, warmupTime: 500 });
  slow.add(
    'writer.json.encrypted',
    () =>
      createQrStreamWriter(json, {
        filename: 'bench.json',
        preset: 'fast',
        sessionId: SESSION,
        passphrase: PASSPHRASE,
      }),
    { async: true },
  );
  slow.add(
    'writer.random.encrypted',
    () =>
      createQrStreamWriter(random, {
        filename: 'bench.bin',
        preset: 'fast',
        sessionId: SESSION,
        passphrase: PASSPHRASE,
      }),
    { async: true },
  );

  const slowSpecs: MetricSpec[] = [
    {
      id: 'writer.json.encrypted',
      group: 'writer',
      description: '1 MiB compressible JSON with PBKDF2 (600k) + AES-GCM',
      unit: 'ms',
    },
    {
      id: 'writer.random.encrypted',
      group: 'writer',
      description: '1 MiB incompressible data with PBKDF2 (600k) + AES-GCM',
      unit: 'ms',
    },
  ];
  metrics.push(...(await runAndCollect(slow, slowSpecs)));

  // Approximate retained footprint while the writer object is alive.
  const plainHeap = await measureArrayBufferMibAsync(() =>
    createQrStreamWriter(random, { filename: 'bench.bin', preset: 'fast', sessionId: SESSION }),
  );
  const encryptedHeap = await measureArrayBufferMibAsync(() =>
    createQrStreamWriter(random, {
      filename: 'bench.bin',
      preset: 'fast',
      sessionId: SESSION,
      passphrase: PASSPHRASE,
    }),
  );

  metrics.push(
    constantMetric(
      {
        id: 'writer.random.plain.heap',
        group: 'writer',
        description: 'approximate retained heap + ArrayBuffer after a plain 1 MiB prepare',
        unit: 'MiB',
      },
      plainHeap,
      true,
    ),
    constantMetric(
      {
        id: 'writer.random.encrypted.heap',
        group: 'writer',
        description: 'approximate retained heap + ArrayBuffer after an encrypted 1 MiB prepare',
        unit: 'MiB',
      },
      encryptedHeap,
      true,
    ),
  );

  return metrics;
}
