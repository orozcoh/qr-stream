// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type * as RenderModule from '../src/browser/render.js';
import { RenderError } from '../src/core/errors.js';
import { QrStreamSender } from '../src/react/QrStreamSender.js';

// The sender's controller lifecycle cannot be observed through jsdom's canvas,
// so record every render and frame-rate call. The writer hook is stubbed: this
// file tests the sender's own contract, not writer construction.
const h = vi.hoisted(() => ({
  writer: { writer: null as unknown, error: null as unknown, pending: false },
  render: vi.fn(),
  setFps: vi.fn(),
  stop: vi.fn(),
  play: vi.fn(),
}));

vi.mock('../src/react/useQrStreamWriter', () => ({ useQrStreamWriter: () => h.writer }));

vi.mock('../src/browser/render.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RenderModule>();
  return {
    ...actual,
    renderQrStream: (...args: Parameters<typeof actual.renderQrStream>) => {
      h.render(...args);
      return {
        play: h.play,
        pause: (): void => undefined,
        setFps: h.setFps,
        stop: h.stop,
        framesPainted: (): number => 0,
      };
    },
  };
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  h.writer.writer = null;
  h.writer.error = null;
  h.writer.pending = false;
  h.render.mockReset();
  h.setFps.mockReset();
  h.stop.mockReset();
  h.play.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.querySelectorAll('style').forEach((node) => node.remove());
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  await act(async () => {
    root.render(element);
  });
  return container;
}

async function clickButton(view: HTMLElement, label: string): Promise<void> {
  const button = [...view.querySelectorAll('button')].find((node) => node.textContent === label);
  expect(button, `missing button: ${label}`).toBeDefined();
  await act(async () => {
    button?.click();
  });
}

/** React tracks the value through the prototype setter; a direct assignment skips its listener. */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

test('changing fps updates the live controller and does not rebuild the stream', async () => {
  h.writer.writer = { k: 40 };
  const view = await render(createElement(QrStreamSender, {}));
  await clickButton(view, 'Start stream');
  expect(h.render).toHaveBeenCalledTimes(1);
  expect(h.render).toHaveBeenCalledWith(expect.objectContaining({ fps: 12 }));

  const range = view.querySelector('input[type="range"]') as HTMLInputElement;
  expect(range).not.toBeNull();

  await act(async () => {
    setInputValue(range, '20');
  });

  expect(h.setFps).toHaveBeenCalledWith(20);
  // The writer and controller identity are unchanged: a frame-rate change must
  // not restart the stream and lose the receiver's progress.
  expect(h.render).toHaveBeenCalledTimes(1);
});

test('a render failure surfaces RENDER_FAILED and leaves the sender stopped', async () => {
  h.writer.writer = { k: 40 };
  h.render.mockImplementationOnce(() => {
    throw new RenderError('canvas 2d context unavailable');
  });
  const view = await render(createElement(QrStreamSender, { formatError: (error) => error.code }));

  await clickButton(view, 'Start stream');

  const alerts = [...view.querySelectorAll('p[role="alert"]')].map((node) => node.textContent);
  expect(alerts).toContain('RENDER_FAILED');
  expect([...view.querySelectorAll('button')].map((node) => node.textContent)).toContain('Start stream');
});

test('a file read failure surfaces COMPRESSION_FAILED and does not reject', async () => {
  const view = await render(createElement(QrStreamSender, { formatError: (error) => error.code }));

  const input = view.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    value: [
      {
        name: 'blocked.bin',
        type: 'application/octet-stream',
        size: 16,
        arrayBuffer: async () => {
          throw new DOMException('denied', 'NotReadableError');
        },
      },
    ],
    configurable: true,
  });

  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });

  const alerts = [...view.querySelectorAll('p[role="alert"]')].map((node) => node.textContent);
  expect(alerts).toContain('COMPRESSION_FAILED');
});
