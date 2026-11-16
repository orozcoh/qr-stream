import { Bench } from 'tinybench';
import { renderQrStream } from '../src/browser/render.js';
import { FRAME_OVERHEAD } from '../src/core/types.js';
import { qrCapacity, packetToMatrix } from '../src/qr/matrix.js';
import { matrixToRGBA } from '../src/qr/raster.js';
import { installFakeCanvas } from './fake-canvas.js';
import { packetFor } from './fixtures.js';
import { constantMetric, runAndCollect, type BenchMetric, type MetricSpec } from './util.js';

const PACKET_COUNT = 8;
const PAINT_FRAMES = 16;

const packetsFor = (version: number): Uint8Array[] => {
  const capacity = qrCapacity(version) - FRAME_OVERHEAD;
  return Array.from({ length: PACKET_COUNT }, (_, index) => packetFor(capacity, 0xabc000 + version * 100 + index));
};

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function* cycle(packets: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (;;) {
    for (const packet of packets) yield packet;
  }
}

/**
 * Time the synchronous part of a real `renderQrStream` paint.
 *
 * The fake canvas makes `putImageData`/`drawImage` no-ops, so this covers
 * matrix construction, RGBA expansion, and the per-frame `ImageData` wrapper
 * but not the browser's raster work. That is called out in the docs; the
 * budget is an upper-bound guard on the JavaScript side.
 */
async function paintFrameMetric(version: number, fps: number): Promise<BenchMetric> {
  const id = `render.v${version}.paintFrame`;
  const environment = installFakeCanvas(512);
  try {
    const controller = renderQrStream({
      packets: cycle(packetsFor(version)),
      canvas: environment.canvas,
      version,
      fps,
    });

    try {
      let time = 1;
      const interval = 1000 / fps;
      controller.play();
      await flushMicrotasks();
      for (let frame = 0; frame < 6; frame += 1) {
        environment.step(time);
        time += interval;
        await flushMicrotasks();
      }

      const bench = new Bench({ name: `render-paint-v${version}`, time: 700, iterations: 6, warmupTime: 200 });
      bench.add(
        id,
        async () => {
          const paintedBefore = controller.framesPainted();
          const wallStart = performance.now();
          let paint = 0;

          for (let frame = 0; frame < PAINT_FRAMES; frame += 1) {
            const start = performance.now();
            environment.step(time);
            paint += performance.now() - start;
            time += interval;
            await flushMicrotasks();
          }

          const wall = performance.now() - wallStart;
          const painted = controller.framesPainted() - paintedBefore;
          if (painted <= 0) throw new Error('render controller painted no frames');
          return { overriddenDuration: paint / painted, overriddenIterationCost: wall };
        },
        { async: true },
      );

      const spec: MetricSpec = {
        id,
        group: 'render',
        description: `full paint path per frame at v${version} (fake canvas; excludes raster compositing)`,
        unit: 'ms',
      };

      const [metric] = await runAndCollect(bench, [spec]);
      if (metric === undefined) throw new Error(`${id} produced no metric`);
      return metric;
    } finally {
      controller.stop();
    }
  } finally {
    environment.restore();
  }
}

export async function runRenderBench(): Promise<BenchMetric[]> {
  const packets = {
    20: packetsFor(20),
    40: packetsFor(40),
  } as const;
  const matrix = {
    20: packetToMatrix(packets[20][0] as Uint8Array, 20),
    40: packetToMatrix(packets[40][0] as Uint8Array, 40),
  } as const;

  const matrixBench = new Bench({ name: 'render-matrix', time: 700, iterations: 10, warmupTime: 200 });
  matrixBench.add('render.v20.packetToMatrix', () => packetToMatrix(packets[20][0] as Uint8Array, 20));
  matrixBench.add('render.v40.packetToMatrix', () => packetToMatrix(packets[40][0] as Uint8Array, 40));

  const matrixSpecs: MetricSpec[] = [
    {
      id: 'render.v20.packetToMatrix',
      group: 'render',
      description: 'encode one full packet as a version 20 QR matrix',
      unit: 'ms',
    },
    {
      id: 'render.v40.packetToMatrix',
      group: 'render',
      description: 'encode one full packet as a version 40 QR matrix',
      unit: 'ms',
    },
  ];
  const metrics = await runAndCollect(matrixBench, matrixSpecs);

  const rasterBench = new Bench({ name: 'render-raster', time: 700, iterations: 10, warmupTime: 200 });
  rasterBench.add('render.v20.matrixToRGBA', () => matrixToRGBA(matrix[20], 1));
  rasterBench.add('render.v40.matrixToRGBA', () => matrixToRGBA(matrix[40], 1));

  const rasterSpecs: MetricSpec[] = [
    {
      id: 'render.v20.matrixToRGBA',
      group: 'render',
      description: 'expand a version 20 matrix at scale 1 (one pixel per module + quiet zone)',
      unit: 'ms',
    },
    {
      id: 'render.v40.matrixToRGBA',
      group: 'render',
      description: 'expand a version 40 matrix at scale 1 (one pixel per module + quiet zone)',
      unit: 'ms',
    },
  ];
  metrics.push(...(await runAndCollect(rasterBench, rasterSpecs)));

  const paint20 = await paintFrameMetric(20, 15);
  const paint40 = await paintFrameMetric(40, 6);
  metrics.push(paint20, paint40);

  const rgba40KiB = ((matrix[40].size + 8) * (matrix[40].size + 8) * 4) / 1024;
  metrics.push(
    constantMetric(
      {
        id: 'render.v20.sustainedFps',
        group: 'render',
        description: 'derived frames/second from the v20 paint measurement (60 Hz refresh)',
        unit: 'fps',
      },
      1000 / paint20.value,
    ),
    constantMetric(
      {
        id: 'render.v40.sustainedFps',
        group: 'render',
        description: 'derived frames/second from the v40 paint measurement (60 Hz refresh)',
        unit: 'fps',
      },
      1000 / paint40.value,
    ),
    constantMetric(
      {
        id: 'render.v40.rgbaKiB',
        group: 'render',
        description: 'bytes allocated per v40 frame by matrixToRGBA, including the 4-module quiet zone',
        unit: 'KiB',
      },
      rgba40KiB,
    ),
  );

  return metrics;
}
