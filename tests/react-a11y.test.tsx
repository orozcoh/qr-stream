// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CameraCapabilities } from '../src/browser/camera.js';
import { CameraError, QrStreamError, WrongKeyError } from '../src/core/errors.js';
import { QrStreamReceiver } from '../src/react/QrStreamReceiver.js';
import { QrStreamSender } from '../src/react/QrStreamSender.js';

// The packaged components only reach the wrong-key, verified, torch, and error
// states after an effect or a camera event. The hooks are stubbed so each state
// can be rendered directly and its accessible output asserted.
const h = vi.hoisted(() => {
  const noop = (): void => undefined;
  return {
    reader: {
      progress: { solved: 0, k: 0 },
      solveRate: 0,
      result: null as { data: Uint8Array; meta: { filename: string } } | null,
      wrongKey: false,
      stale: false,
      error: null as unknown,
      add: noop,
      retryKey: async (): Promise<void> => undefined,
      reset: noop,
    },
    camera: {
      videoRef: { current: null },
      devices: [] as { deviceId: string; label: string; facing: string; groupId: string }[],
      activeId: null as string | null,
      select: async (): Promise<void> => undefined,
      cycle: async (): Promise<void> => undefined,
      rescan: async (): Promise<void> => undefined,
      start: async (): Promise<void> => undefined,
      stop: noop,
      starting: false,
      switching: false,
      error: null as unknown,
      ready: true,
      diagnostics: null as {
        devices: unknown[];
        active: { label: string; settings: MediaTrackSettings; capabilities: CameraCapabilities } | null;
      } | null,
      zoom: null as { min: number; max: number; step: number } | null,
      zoomValue: 0,
      setZoom: async (): Promise<void> => undefined,
      torchSupported: false,
      torch: false,
      setTorch: async (): Promise<void> => undefined,
    },
    writer: { writer: null as unknown, error: null as unknown, pending: false },
  };
});

vi.mock('../src/react/useQrStreamReader', () => ({ useQrStreamReader: () => h.reader }));
vi.mock('../src/react/useCameraReader', () => ({ useCameraReader: () => h.camera }));
vi.mock('../src/react/useQrStreamWriter', () => ({ useQrStreamWriter: () => h.writer }));

const stubDecoder = async () => ({ decode: async () => null });

const resetState = (): void => {
  Object.assign(h.reader, {
    progress: { solved: 0, k: 0 },
    solveRate: 0,
    result: null,
    wrongKey: false,
    stale: false,
    error: null,
  });
  Object.assign(h.camera, {
    devices: [],
    activeId: null,
    switching: false,
    error: null,
    diagnostics: null,
    zoom: null,
    zoomValue: 0,
    torchSupported: false,
    torch: false,
  });
  Object.assign(h.writer, { writer: null, error: null, pending: false });
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetState();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  await act(async () => {
    root.render(element);
  });
  return container;
}

test('a verified transfer announces itself and offers one save anchor', async () => {
  h.reader.result = { data: new Uint8Array([1, 2, 3]), meta: { filename: 'report.json' } };

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));

  const status = view.querySelector('[role="status"]');
  expect(status?.textContent).toBe('report.json — SHA-256 verified');

  const anchors = view.querySelectorAll('a');
  expect(anchors).toHaveLength(1);
  expect(anchors[0]?.getAttribute('href')).toBe('blob:mock');
  expect(anchors[0]?.getAttribute('download')).toBe('report.json');
  expect(anchors[0]?.textContent).toBe('Save file');
  expect(anchors[0]?.querySelector('button')).toBeNull();
  expect(view.querySelector('a button')).toBeNull();
  expect(view.textContent).toContain('Receive another');
});

test('a wrong passphrase gets actionable copy and a labelled unlock input', async () => {
  h.reader.wrongKey = true;
  h.reader.error = new WrongKeyError();

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));

  expect(view.textContent).toContain('That passphrase does not match. Try again — no need to rescan.');
  expect(view.textContent).not.toContain('The passphrase does not match this transfer');

  const alerts = view.querySelectorAll('[role="alert"]');
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toBe('That passphrase does not match. Try again — no need to rescan.');

  const label = view.querySelector('label[for]');
  const input = view.querySelector('input[type="password"]');
  expect(label?.textContent).toBe('Passphrase');
  expect(input?.id).toBeTruthy();
  expect(label?.getAttribute('for')).toBe(input?.id);

  expect(view.textContent).toContain('Unlock');
});

test('a wrong passphrase honours custom copy', async () => {
  h.reader.wrongKey = true;
  h.reader.error = new WrongKeyError();

  const view = await render(
    createElement(QrStreamReceiver, {
      decoder: stubDecoder,
      strings: { wrongKey: 'Clave incorrecta.', unlock: 'Abrir' },
    }),
  );

  expect(view.textContent).toContain('Clave incorrecta.');
  expect(view.textContent).toContain('Abrir');
  expect(view.textContent).not.toContain('That passphrase does not match');
});

test('camera and reader errors are both formatted and announced', async () => {
  h.camera.error = new CameraError('CAMERA_PERMISSION_DENIED', 'Camera permission was denied.');
  h.reader.error = new QrStreamError('INVALID_PACKET', 'bad frame');

  const view = await render(
    createElement(QrStreamReceiver, { decoder: stubDecoder, formatError: (error) => `err:${error.code}` }),
  );

  const alerts = [...view.querySelectorAll('p[role="alert"]')].map((node) => node.textContent);
  expect(alerts).toEqual(['err:CAMERA_PERMISSION_DENIED', 'err:INVALID_PACKET']);
  expect(view.textContent).toContain('Camera unavailable');
});

test('the torch button only exists when the camera reports support', async () => {
  h.camera.torchSupported = true;
  h.camera.torch = true;

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  const pressed = view.querySelector('button[aria-pressed]');
  expect(pressed?.textContent).toBe('Torch on');
  expect(pressed?.getAttribute('aria-pressed')).toBe('true');

  h.camera.torch = false;
  const off = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  const released = off.querySelector('button[aria-pressed]');
  expect(released?.textContent).toBe('Torch off');
  expect(released?.getAttribute('aria-pressed')).toBe('false');

  h.camera.torchSupported = false;
  const absent = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  expect(absent.querySelector('button[aria-pressed]')).toBeNull();
  expect(absent.textContent).not.toContain('Torch');
});

test('stale frames offer the switch using the translated copy', async () => {
  h.reader.stale = true;

  const view = await render(
    createElement(QrStreamReceiver, {
      decoder: stubDecoder,
      strings: { stale: 'Otra transferencia.', switchToNew: 'Cambiar' },
    }),
  );

  expect(view.textContent).toContain('Otra transferencia.');
  expect(view.textContent).toContain('Cambiar');
  expect(view.textContent).not.toContain('A different transfer is being sent');
});

test('the diagnostics table is captioned and reports the active camera', async () => {
  h.camera.devices = [{ deviceId: 'cam1', label: 'Back camera', facing: 'environment', groupId: 'grp123' }];
  h.camera.activeId = 'cam1';
  h.camera.diagnostics = {
    devices: [],
    active: {
      label: 'Back camera',
      settings: { width: 640, height: 480, frameRate: 30 },
      capabilities: { focusMode: ['continuous'] },
    },
  };

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));

  expect(view.querySelector('caption')?.textContent).toBe('Cameras reported by this browser (1)');
  expect(view.textContent).toContain('Active: Back camera · 640×480 @ 30 fps · focus continuous');
  expect([...view.querySelectorAll('th')].map((node) => node.textContent)).toEqual(['#', 'Label', 'Facing', 'Group']);
});

test('a writer error is formatted and announced', async () => {
  h.writer.error = new QrStreamError('WIRE_TOO_LARGE', 'compressed payload is 5000 bytes; the wire limit is 4096');

  const view = await render(createElement(QrStreamSender, { formatError: (error) => `code:${error.code}` }));

  const alerts = view.querySelectorAll('p[role="alert"]');
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toBe('code:WIRE_TOO_LARGE');
});
