import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Bench } from 'tinybench';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { createQrStreamReader } from '../src/core/reader.js';
import { FRAME_OVERHEAD } from '../src/core/types.js';
import { packetToMatrix, qrCapacity } from '../src/qr/matrix.js';
import { matrixToRGBA } from '../src/qr/raster.js';
import { packetFor, MIB } from './fixtures.js';
import { streamFixture } from './stream.js';
import { constantMetric, runAndCollect, type BenchMetric, type MetricSpec } from './util.js';

const requireFromHere = createRequire(import.meta.url);

interface SyntheticFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Build a camera-like frame: the QR at an integer scale, centered on a white
 * background. zxing scans the whole frame, so resolution and background area
 * both affect the cost, as they do with a real camera capture.
 */
function syntheticFrame(width: number, height: number, version: number, scale: number, seed: number): SyntheticFrame {
  const packet = packetFor(qrCapacity(version) - FRAME_OVERHEAD, seed);
  const matrix = packetToMatrix(packet, version);
  const qr = matrixToRGBA(matrix, 1);

  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  const left = Math.floor((width - qr.width * scale) / 2);
  const top = Math.floor((height - qr.height * scale) / 2);
  for (let y = 0; y < qr.height * scale; y += 1) {
    for (let x = 0; x < qr.width * scale; x += 1) {
      const source = (Math.floor(y / scale) * qr.width + Math.floor(x / scale)) * 4;
      const target = ((top + y) * width + (left + x)) * 4;
      data[target] = qr.data[source] as number;
      data[target + 1] = qr.data[source + 1] as number;
      data[target + 2] = qr.data[source + 2] as number;
      data[target + 3] = 255;
    }
  }

  return { data, width, height };
}

interface ZXingFixture {
  startupMs: number;
  frames: Array<{ id: string; description: string; frame: SyntheticFrame }>;
}

/**
 * zxing-wasm is browser-targeted; in Node the Emscripten loader cannot fetch
 * the wasm URL, so the binary is read from disk and passed as `wasmBinary`.
 * The browser path (`createZXingDecoder` with a served `wasmUrl`) is covered
 * by the Playwright camera spec.
 */
async function loadZXing(): Promise<ZXingFixture> {
  const wasmPath = requireFromHere.resolve('zxing-wasm/reader/zxing_reader.wasm');
  const wasmBinary = readFileSync(wasmPath) as unknown as ArrayBuffer;

  const start = performance.now();
  await prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
  const startupMs = performance.now() - start;

  return {
    startupMs,
    frames: [
      {
        id: 'reader.zxing.720p.v20',
        description: 'read a synthetic 1280x720 frame containing a version 20 code',
        frame: syntheticFrame(1280, 720, 20, 5, 0x72020),
      },
      {
        id: 'reader.zxing.720p.v40',
        description: 'read a synthetic 1280x720 frame containing a version 40 code',
        frame: syntheticFrame(1280, 720, 40, 3, 0x72040),
      },
      {
        id: 'reader.zxing.1080p.v40',
        description: 'read a synthetic 1920x1080 frame containing a version 40 code',
        frame: syntheticFrame(1920, 1080, 40, 4, 0x108040),
      },
    ],
  };
}

export async function runReaderBench(): Promise<BenchMetric[]> {
  const fixture = await streamFixture();
  const metrics: BenchMetric[] = [];

  const slow = new Bench({ name: 'reader-stream', time: 5000, iterations: 5, warmupTime: 400 });
  slow.add('reader.stream.add', () => {
    const reader = createQrStreamReader();
    for (const packet of fixture.packets) reader.add(packet);
    if (reader.progress().solved !== fixture.k) throw new Error('reader did not solve the stream');
  });
  slow.add(
    'reader.stream.reassemble',
    async () => {
      const reader = createQrStreamReader();
      for (const packet of fixture.packets) reader.add(packet);
      const result = await reader.result();
      if (result === null || result.data.length !== MIB) {
        throw new Error('reader did not reassemble the stream');
      }
    },
    { async: true },
  );

  const slowSpecs: MetricSpec[] = [
    {
      id: 'reader.stream.add',
      group: 'reader',
      description: 'add every accepted packet of the lossy 1 MiB stream (CRC + plausibility + fountain)',
      unit: 'ms',
    },
    {
      id: 'reader.stream.reassemble',
      group: 'reader',
      description: 'the same add loop plus result(): SHA-256 verification of 1 MiB',
      unit: 'ms',
    },
  ];
  metrics.push(...(await runAndCollect(slow, slowSpecs)));

  const add = metrics.find((metric) => metric.id === 'reader.stream.add');
  if (add === undefined) throw new Error('reader.stream.add is missing');

  metrics.push(
    constantMetric(
      {
        id: 'reader.frame.add',
        group: 'reader',
        description: 'derived mean cost per accepted frame at 15 fps',
        unit: 'ms',
      },
      add.value / fixture.packets.length,
    ),
  );

  const zxing = await loadZXing();
  metrics.push(
    constantMetric(
      {
        id: 'reader.zxing.startup',
        group: 'reader',
        description: 'compile instantiate the zxing reader wasm (Node, binary from disk)',
        unit: 'ms',
      },
      zxing.startupMs,
    ),
  );

  const bench = new Bench({ name: 'reader-zxing', time: 1200, iterations: 8, warmupTime: 300 });
  const specs: MetricSpec[] = [];
  for (const { id, description, frame } of zxing.frames) {
    const first = await readBarcodes(frame as unknown as ImageData, { formats: ['QRCode'] });
    if (!first.some((result) => result.isValid)) {
      throw new Error(`${id}: zxing could not read the synthetic frame`);
    }
    bench.add(
      id,
      async () => {
        const results = await readBarcodes(frame as unknown as ImageData, { formats: ['QRCode'] });
        if (!results.some((result) => result.isValid)) throw new Error(`${id}: decode failed`);
      },
      { async: true },
    );
    specs.push({ id, group: 'reader', description, unit: 'ms' });
  }
  metrics.push(...(await runAndCollect(bench, specs)));

  return metrics;
}
