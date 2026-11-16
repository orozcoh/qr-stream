// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { CompressionStream, DecompressionStream } from 'node:stream/web';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WrongKeyError } from '../src/core/errors.js';
import { createQrStreamReader } from '../src/core/reader.js';
import type * as ReaderModule from '../src/core/reader.js';
import { createQrStreamWriter, type QrStreamWriter } from '../src/core/writer.js';
import {
  useQrStreamReader,
  type UseQrStreamReaderOptions,
  type UseQrStreamReaderResult,
} from '../src/react/useQrStreamReader.js';

vi.mock('../src/core/reader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ReaderModule>();
  return { ...actual, createQrStreamReader: vi.fn(actual.createQrStreamReader) };
});

interface HarnessProps {
  options: UseQrStreamReaderOptions;
  capture(result: UseQrStreamReaderResult): void;
}

function Harness({ options, capture }: HarnessProps) {
  const result = useQrStreamReader(options);
  capture(result);
  return null;
}

interface View {
  readonly result: UseQrStreamReaderResult;
  rerender(next?: UseQrStreamReaderOptions): void;
  unmount(): void;
}

function renderHarness(initial: UseQrStreamReaderOptions = {}): View {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let options = initial;
  let result: UseQrStreamReaderResult | null = null;
  const capture = (next: UseQrStreamReaderResult): void => {
    result = next;
  };
  const render = (): void => {
    act(() => {
      root.render(<Harness options={options} capture={capture} />);
    });
  };
  render();
  return {
    get result() {
      if (result === null) throw new Error('harness rendered nothing');
      return result;
    },
    rerender(next = {}) {
      options = next;
      render();
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function settle(check: () => void, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    try {
      check();
      return;
    } catch (failure) {
      if (Date.now() - start > timeoutMs) throw failure;
    }
  }
}

async function collect(writer: QrStreamWriter): Promise<Uint8Array[]> {
  const packets: Uint8Array[] = [];
  for await (const packet of writer.packets()) {
    packets.push(packet);
    // The first K packets are the source symbols; together they reconstruct
    // the payload exactly.
    if (packets.length >= writer.k) break;
  }
  return packets;
}

const passphrase = 'blue seven kilo';

async function encryptedWriter(): Promise<{ writer: QrStreamWriter; packets: Uint8Array[]; data: Uint8Array }> {
  const data = new TextEncoder().encode(JSON.stringify({ hello: 'reader', items: [1, 2, 3] }));
  const writer = await createQrStreamWriter(data, { filename: 'a.json', preset: 'fast', passphrase });
  return { writer, packets: await collect(writer), data };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom's Crypto does not always expose SubtleCrypto; the loopback needs it.
  vi.stubGlobal('crypto', webcrypto);
  // jsdom also omits the Compression Streams API the writer uses.
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('CompressionStream', CompressionStream);
  vi.stubGlobal('DecompressionStream', DecompressionStream);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test('creates one reader and passes limits as initial configuration', async () => {
  const view = renderHarness({ limits: { maxWireBytes: 4096 } });
  await flush();

  view.rerender({ limits: { maxWireBytes: 2048 } });
  await flush();

  expect(createQrStreamReader).toHaveBeenCalledTimes(1);
  expect(createQrStreamReader).toHaveBeenCalledWith({ limits: { maxWireBytes: 4096 } });
  view.unmount();
});

test('a wrong passphrase exposes a typed WrongKeyError', async () => {
  const { packets } = await encryptedWriter();
  const view = renderHarness({ passphrase: 'wrong' });

  act(() => {
    for (const packet of packets) view.result.add(packet);
  });
  await settle(() => expect(view.result.wrongKey).toBe(true));

  expect(view.result.error).toBeInstanceOf(WrongKeyError);
  expect(view.result.error?.code).toBe('WRONG_PASSPHRASE');
  expect(view.result.result).toBeNull();
  view.unmount();
});

test('a successful retryKey clears the wrong-key error and delivers the data', async () => {
  const { packets, data } = await encryptedWriter();
  const view = renderHarness({ passphrase: 'wrong' });

  act(() => {
    for (const packet of packets) view.result.add(packet);
  });
  await settle(() => expect(view.result.wrongKey).toBe(true));

  await act(async () => {
    await view.result.retryKey(passphrase);
  });

  expect(view.result.error).toBeNull();
  expect(view.result.wrongKey).toBe(false);
  // Cross-realm typed arrays do not compare deeply under jsdom; compare bytes.
  expect(Array.from(view.result.result?.data ?? [])).toEqual(Array.from(data));
  view.unmount();
});

test('reset clears the error and the wrong-key state', async () => {
  const { packets } = await encryptedWriter();
  const view = renderHarness({ passphrase: 'wrong' });

  act(() => {
    for (const packet of packets) view.result.add(packet);
  });
  await settle(() => expect(view.result.wrongKey).toBe(true));

  act(() => view.result.reset());

  expect(view.result.error).toBeNull();
  expect(view.result.wrongKey).toBe(false);
  expect(view.result.result).toBeNull();
  expect(view.result.progress).toEqual({ solved: 0, k: 0 });
  view.unmount();
});
