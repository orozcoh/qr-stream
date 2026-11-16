import { Bench } from 'tinybench';
import { renderQrStream } from '../src/browser/render.js';
import { FRAME_OVERHEAD } from '../src/core/types.js';
import { qrCapacity, packetToMatrix } from '../src/qr/matrix.js';
import { matrixToRGBA } from '../src/qr/raster.js';
import { installFakeCanvas } from './fake-canvas.js';
import { packetFor } from './fixtures.js';
import { forceGc, gcAvailable } from './memory.js';
import { constantMetric, runAndCollect, type BenchMetric, type MetricSpec } from './util.js';

const PACKET_COUNT = 8;
const PAINT_FRAMES = 16;
const ALLOC_FRAMES = 16;
const ALLOC_ROUNDS = 3;
const COUNTED_FRAMES = 5;

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

/**
 * Measure how much ArrayBuffer memory one painted v40 frame allocates.
 *
 * The fake canvas makes every canvas operation a no-op, so the only array
 * buffer allocated per frame is the `matrixToRGBA` result (the stub
 * `ImageData` keeps a reference rather than copying). Forcing GC before each
 * round and reading `arrayBuffers` before/after 16 frames gives a per-frame
 * delta. The maximum of three rounds is used because a collection that lands
 * mid-round can only undercount, never invent an allocation.
 *
 * A second per-frame buffer would roughly double the delta and trip the
 * budget; the returned-buffer-size metric next to it cannot catch that.
 */
async function paintAllocationMetric(): Promise<BenchMetric> {
  const id = 'render.v40.paintAllocKiB';
  // Holding every painted frame makes the primary per-frame buffer
  // uncollectable, so the ArrayBuffer delta reflects allocation rather than
  // whatever V8 happened to reclaim between frames.
  const retained: Uint8ClampedArray[] = [];
  const environment = installFakeCanvas(512, retained);
  try {
    const controller = renderQrStream({
      packets: cycle(packetsFor(40)),
      canvas: environment.canvas,
      version: 40,
      fps: 6,
    });

    try {
      let time = 1;
      const interval = 1000 / 6;
      controller.play();
      await flushMicrotasks();
      for (let frame = 0; frame < 3; frame += 1) {
        environment.step(time);
        time += interval;
        await flushMicrotasks();
      }

      const samples: number[] = [];
      for (let round = 0; round < ALLOC_ROUNDS; round += 1) {
        forceGc();
        const before = process.memoryUsage().arrayBuffers;
        const retainedBefore = retained.length;
        for (let frame = 0; frame < ALLOC_FRAMES; frame += 1) {
          environment.step(time);
          time += interval;
          await flushMicrotasks();
        }
        const painted = retained.length - retainedBefore;
        const after = process.memoryUsage().arrayBuffers;
        // A step can occasionally miss the fps accumulator by a floating-point
        // hair; divide by frames actually painted so a skip does not skew the
        // per-frame number.
        if (painted <= 0) throw new Error('render allocation probe painted no frames');
        samples.push((after - before) / 1024 / painted);
        retained.length = 0;
      }

      return constantMetric(
        {
          id,
          group: 'render',
          description: `measured ArrayBuffer growth per painted v40 frame (${ALLOC_FRAMES} frames, GC before each round)`,
          unit: 'KiB',
        },
        Math.max(...samples),
        !gcAvailable(),
      );
    } finally {
      controller.stop();
    }
  } finally {
    environment.restore();
  }
}

/**
 * Count every byte of `Uint8ClampedArray` allocated by one painted frame.
 *
 * The ArrayBuffer delta above is a real measurement, but it can undercount a
 * short-lived second buffer that V8 reclaims between frames. Swapping the
 * constructor for the duration of the synchronous paint counts allocations
 * regardless of collection, so a second/intermediate buffer doubles the value
 * even when it is discarded immediately. Only the paint call runs while the
 * constructor is replaced; it is restored in `finally`.
 */
async function paintFrameBytesMetric(): Promise<BenchMetric> {
  const id = 'render.v40.frameBytesKiB';
  const environment = installFakeCanvas(512);
  try {
    const controller = renderQrStream({
      packets: cycle(packetsFor(40)),
      canvas: environment.canvas,
      version: 40,
      fps: 6,
    });

    try {
      let time = 1;
      const interval = 1000 / 6;
      controller.play();
      await flushMicrotasks();
      for (let frame = 0; frame < 3; frame += 1) {
        environment.step(time);
        time += interval;
        await flushMicrotasks();
      }

      const globals = globalThis as { Uint8ClampedArray: typeof Uint8ClampedArray };
      const Original = globals.Uint8ClampedArray;
      const samples: number[] = [];

      try {
        for (let round = 0; round < COUNTED_FRAMES; round += 1) {
          let bytes = 0;
          class CountingArray extends Original {
            constructor(...args: ConstructorParameters<typeof Uint8ClampedArray>) {
              super(...args);
              bytes += this.byteLength;
            }
          }
          globals.Uint8ClampedArray = CountingArray as unknown as typeof Uint8ClampedArray;

          const paintedBefore = controller.framesPainted();
          try {
            // A floating-point hair can make a single step miss the fps
            // accumulator; step until at least one frame paints.
            for (let attempt = 0; attempt < 3 && controller.framesPainted() === paintedBefore; attempt += 1) {
              environment.step(time);
              time += interval;
            }
          } finally {
            globals.Uint8ClampedArray = Original;
          }

          const painted = controller.framesPainted() - paintedBefore;
          await flushMicrotasks();
          if (painted <= 0) throw new Error('render byte probe painted no frames');
          samples.push(bytes / 1024 / painted);
        }
      } finally {
        globals.Uint8ClampedArray = Original;
      }

      return constantMetric(
        {
          id,
          group: 'render',
          description: 'Uint8ClampedArray bytes allocated per painted v40 frame (constructor accounting)',
          unit: 'KiB',
        },
        Math.max(...samples),
      );
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

  const paintAlloc40 = await paintAllocationMetric();
  const frameBytes40 = await paintFrameBytesMetric();
  const rgbaBuffer40KiB = matrixToRGBA(matrix[40], 1).data.byteLength / 1024;

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
        id: 'render.v40.rgbaBufferKiB',
        group: 'render',
        description: 'returned RGBA buffer size per v40 frame, read from a real matrixToRGBA call at scale 1',
        unit: 'KiB',
      },
      rgbaBuffer40KiB,
    ),
    paintAlloc40,
    frameBytes40,
  );

  return metrics;
}
