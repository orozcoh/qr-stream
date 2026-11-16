import { Bench } from 'tinybench';
import { FountainDecoder } from '../src/core/fountain.js';
import { decodePacket } from '../src/core/packet.js';
import { streamFixture } from './stream.js';
import { constantMetric, runAndCollect, type BenchMetric, type MetricSpec } from './util.js';

export async function runFountainBench(): Promise<BenchMetric[]> {
  const fixture = await streamFixture();

  const slow = new Bench({ name: 'fountain-decode', time: 5000, iterations: 5, warmupTime: 400 });
  slow.add('fountain.stream.decode', () => {
    const decoder = new FountainDecoder(fixture.k, fixture.blockSize, fixture.sessionId);
    for (const bytes of fixture.packets) {
      const packet = decodePacket(bytes);
      if (packet === null) throw new Error('fixture packet became invalid');
      decoder.add(packet.symbolIdx, packet.payload);
    }
    if (!decoder.isComplete) throw new Error('fixture stream did not complete');
  });

  const slowSpecs: MetricSpec[] = [
    {
      id: 'fountain.stream.decode',
      group: 'fountain',
      description: 'decode a lossy 1 MiB / fast-preset stream (1/4 of systematic frames missing)',
      unit: 'ms',
    },
  ];
  const metrics = await runAndCollect(slow, slowSpecs);

  // A completed decoder is the input for assembly so this measures the copy,
  // not another full decode.
  const complete = new FountainDecoder(fixture.k, fixture.blockSize, fixture.sessionId);
  for (const bytes of fixture.packets) {
    const packet = decodePacket(bytes);
    if (packet !== null) complete.add(packet.symbolIdx, packet.payload);
  }
  if (!complete.isComplete) throw new Error('fixture stream did not complete');

  const fast = new Bench({ name: 'fountain-assemble', time: 700, iterations: 10, warmupTime: 200 });
  fast.add('fountain.stream.assemble', () => complete.assemble());

  const fastSpecs: MetricSpec[] = [
    {
      id: 'fountain.stream.assemble',
      group: 'fountain',
      description: 'concatenate 1252 solved blocks into the 1 MiB payload',
      unit: 'ms',
    },
  ];
  metrics.push(...(await runAndCollect(fast, fastSpecs)));

  metrics.push(
    constantMetric(
      {
        id: 'fountain.stream.symbolsToComplete',
        group: 'fountain',
        description: 'packets needed to close the lossy 1 MiB stream (lower is better)',
        unit: 'packets',
      },
      fixture.symbolsToComplete,
    ),
  );

  return metrics;
}
