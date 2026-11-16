// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { CompressionStream, DecompressionStream } from 'node:stream/web';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createQrStreamWriter } from '../src/core/writer.js';
import type * as WriterModule from '../src/core/writer.js';
import {
  useQrStreamWriter,
  type UseQrStreamWriterOptions,
  type UseQrStreamWriterResult,
} from '../src/react/useQrStreamWriter.js';

vi.mock('../src/core/writer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WriterModule>();
  return { ...actual, createQrStreamWriter: vi.fn(actual.createQrStreamWriter) };
});

/** Deterministic bytes that gzip cannot shrink much. */
function incompressible(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x9e3779b9;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

interface HarnessProps {
  options: UseQrStreamWriterOptions;
  capture(result: UseQrStreamWriterResult): void;
}

function Harness({ options, capture }: HarnessProps) {
  const result = useQrStreamWriter(options);
  capture(result);
  return null;
}

interface View {
  readonly result: UseQrStreamWriterResult;
  rerender(next: Partial<UseQrStreamWriterOptions>): void;
  unmount(): void;
}

function renderHarness(initial: UseQrStreamWriterOptions): View {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let options = initial;
  let result: UseQrStreamWriterResult | null = null;
  const capture = (next: UseQrStreamWriterResult): void => {
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
    rerender(next) {
      options = { ...options, ...next };
      render();
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function settle(check: () => void, timeoutMs = 10_000): Promise<void> {
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

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('CompressionStream', CompressionStream);
  vi.stubGlobal('DecompressionStream', DecompressionStream);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test('WIRE_TOO_LARGE survives the hook instead of becoming INVALID_ARGUMENT', async () => {
  const view = renderHarness({
    data: incompressible(4096),
    filename: 'big.bin',
    preset: 'fast',
    limits: { maxWireBytes: 1024 },
  });

  await settle(() => expect(view.result.error).not.toBeNull());

  expect(view.result.error?.code).toBe('WIRE_TOO_LARGE');
  expect(view.result.error?.recovery).toBe('change-input');
  expect(view.result.writer).toBeNull();
  expect(view.result.pending).toBe(false);
  view.unmount();
});

test('an inline limits object with equal values does not rebuild the writer', async () => {
  const view = renderHarness({
    data: new TextEncoder().encode('{"small":true}'),
    filename: 'small.json',
    preset: 'fast',
    limits: { maxWireBytes: 65536 },
  });

  await settle(() => expect(view.result.writer).not.toBeNull());
  const writer = view.result.writer;

  view.rerender({ limits: { maxWireBytes: 65536 } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  expect(view.result.writer).toBe(writer);
  expect(createQrStreamWriter).toHaveBeenCalledTimes(1);
  view.unmount();
});
