// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CameraCapabilities } from '../src/browser/camera.js';
import type * as RenderModule from '../src/browser/render.js';
import { CameraError, QrStreamError, WrongKeyError } from '../src/core/errors.js';
import { QrStreamReceiver } from '../src/react/QrStreamReceiver.js';
import { QrStreamSender } from '../src/react/QrStreamSender.js';
import { expectNoDefaultCopy, expectSentinels, sentinelStrings, sentinelValue } from './helpers/i18n';

// The packaged components only reach the wrong-key, verified, and error
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
    },
    writer: { writer: null as unknown, error: null as unknown, pending: false },
  };
});

vi.mock('../src/react/useQrStreamReader', () => ({ useQrStreamReader: () => h.reader }));
vi.mock('../src/react/useCameraReader', () => ({ useCameraReader: () => h.camera }));
vi.mock('../src/react/useQrStreamWriter', () => ({ useQrStreamWriter: () => h.writer }));
// jsdom has no 2d context, and the running sender only needs the controller's
// lifecycle to flip `running`.
vi.mock('../src/browser/render.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RenderModule>();
  return {
    ...actual,
    renderQrStream: vi.fn(() => ({
      play: (): void => undefined,
      pause: (): void => undefined,
      setFps: (): void => undefined,
      stop: (): void => undefined,
      framesPainted: (): number => 0,
    })),
  };
});

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

// --- sentinel states -------------------------------------------------------
// The SSR sentinel test can only see the default sender and receiver. These
// tests drive every other state a key appears in, render it with the sentinel
// copy, and assert the sentinel is on screen while no default English remains.

const device = (id: string, label: string) => ({ deviceId: id, label, facing: 'environment', groupId: `grp-${id}` });

async function clickButton(view: HTMLElement, label: string): Promise<void> {
  const button = [...view.querySelectorAll('button')].find((node) => node.textContent === label);
  expect(button, `missing button: ${label}`).toBeDefined();
  await act(async () => {
    button?.click();
  });
}

test('the running sender renders sentinel speed, stop, and stop-to-change copy', async () => {
  h.writer.writer = { k: 40 };
  const strings = sentinelStrings();
  const view = await render(createElement(QrStreamSender, { strings }));

  await clickButton(view, sentinelValue('start'));

  expectSentinels(view.innerHTML, ['speed', 'stop', 'stopToChange']);
  expectNoDefaultCopy(view.innerHTML);
});

test('the idle sender renders sentinel ready and preparing copy', async () => {
  const strings = sentinelStrings();

  h.writer.writer = { k: 40 };
  const ready = await render(createElement(QrStreamSender, { strings }));
  expectSentinels(ready.innerHTML, ['ready']);
  expectNoDefaultCopy(ready.innerHTML);

  h.writer.writer = null;
  h.writer.pending = true;
  const preparing = await render(createElement(QrStreamSender, { strings }));
  expectSentinels(preparing.innerHTML, ['preparing']);
  expectNoDefaultCopy(preparing.innerHTML);
});

async function pickFile(view: HTMLElement, file: { name: string; type: string; size: number }): Promise<void> {
  const input = view.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    value: [{ ...file, arrayBuffer: async () => new ArrayBuffer(0) }],
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('a rejected file type renders the sentinel notice', async () => {
  const strings = sentinelStrings();
  const view = await render(createElement(QrStreamSender, { strings, accept: '.json' }));

  await pickFile(view, { name: 'notes.txt', type: 'text/plain', size: 10 });

  expectSentinels(view.innerHTML, ['fileTypeRejected']);
  expectNoDefaultCopy(view.innerHTML);
});

test('an oversized file renders the sentinel notice', async () => {
  const strings = sentinelStrings();
  const view = await render(createElement(QrStreamSender, { strings, maxBytes: 1024 }));

  await pickFile(view, { name: 'big.bin', type: 'application/octet-stream', size: 4096 });

  expectSentinels(view.innerHTML, ['fileTooLarge']);
  expectNoDefaultCopy(view.innerHTML);
});

test('the receiver renders sentinel camera, switch, and zoom copy', async () => {
  h.camera.devices = [device('cam1', 'Back camera'), device('cam2', 'Front camera')];
  h.camera.activeId = 'cam1';
  h.camera.zoom = { min: 1, max: 4, step: 0.1 };
  h.camera.zoomValue = 2;
  const strings = sentinelStrings();

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder, strings }));
  expectSentinels(view.innerHTML, ['camera', 'switchCamera', 'zoom']);
  expectNoDefaultCopy(view.innerHTML);

  h.camera.switching = true;
  const switching = await render(createElement(QrStreamReceiver, { decoder: stubDecoder, strings }));
  expectSentinels(switching.innerHTML, ['switching', 'scanning']);
  expectNoDefaultCopy(switching.innerHTML);
});

test('a camera failure renders the sentinel placeholder and retry action', async () => {
  h.camera.error = new CameraError('CAMERA_UNAVAILABLE', 'The camera could not be opened.');
  const strings = sentinelStrings();

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder, strings }));
  expectSentinels(view.innerHTML, ['cameraUnavailable', 'tryAgain']);
  expect([...view.querySelectorAll('button')].map((node) => node.textContent)).toContain(sentinelValue('tryAgain'));
  expectNoDefaultCopy(view.innerHTML);
});

test('stale frames render sentinel copy', async () => {
  h.reader.stale = true;
  const strings = sentinelStrings();

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder, strings }));
  expectSentinels(view.innerHTML, ['stale', 'switchToNew']);
  expectNoDefaultCopy(view.innerHTML);
});

test('the wrong-key panel renders sentinel copy and a sentinel placeholder', async () => {
  h.reader.wrongKey = true;
  h.reader.error = new WrongKeyError();
  const strings = sentinelStrings();

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder, strings }));
  expectSentinels(view.innerHTML, ['wrongKey', 'passphraseLabel', 'passphraseInput', 'unlock']);
  expect(view.querySelector('input[type="password"]')?.getAttribute('placeholder')).toBe(
    sentinelValue('passphraseInput'),
  );
  expectNoDefaultCopy(view.innerHTML);
});

test('a completed transfer renders sentinel verified and save copy', async () => {
  h.reader.result = { data: new Uint8Array([1, 2, 3]), meta: { filename: 'report.json' } };
  const strings = sentinelStrings();

  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder, strings }));
  expectSentinels(view.innerHTML, ['verified', 'saveFile', 'receiveAnother']);
  expectNoDefaultCopy(view.innerHTML);
});

test('the active camera line renders sentinel copy, including the unnamed fallback', async () => {
  const diagnostics = (label: string) => ({
    devices: [],
    active: {
      label,
      settings: { width: 640, height: 480, frameRate: 30 },
      capabilities: { focusMode: ['continuous'] },
    },
  });

  h.camera.diagnostics = diagnostics('Back camera');
  const active = await render(createElement(QrStreamReceiver, { decoder: stubDecoder, strings: sentinelStrings() }));
  expectSentinels(active.innerHTML, ['activeCamera']);
  expectNoDefaultCopy(active.innerHTML);

  // `unnamed` is only substituted into `activeCamera`, so give the template a
  // placeholder for it.
  h.camera.diagnostics = diagnostics('');
  const unnamed = await render(
    createElement(QrStreamReceiver, {
      decoder: stubDecoder,
      strings: { ...sentinelStrings(), activeCamera: '{label}' },
    }),
  );
  expectSentinels(unnamed.innerHTML, ['unnamed']);
  expectNoDefaultCopy(unnamed.innerHTML);
});

// --- axe -------------------------------------------------------------------
// axe inspects the real jsdom DOM, but jsdom has no layout engine and no canvas
// implementation. Contrast cannot be measured: axe reports every element as
// `incomplete` and its canvas probe throws "Not implemented". The rule is
// disabled here rather than faked; contrast remains a manual/visual check.
// `video-caption` stays enabled and lands in `incomplete` because axe cannot
// tell whether the feed carries audio; a live camera preview has none, so the
// rule is inapplicable rather than suppressed. Everything else runs with axe's
// default rule set (WCAG 2.0/2.1/2.2 A+AA plus best practice).
const AXE_OPTIONS: axe.RunOptions = {
  rules: { 'color-contrast': { enabled: false } },
};

function summarizeViolations(violations: readonly axe.Result[]): string[] {
  return violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.nodes
        .map((node) => node.target.join(' '))
        .join(', ')}`,
  );
}

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, AXE_OPTIONS);
  // Guard against a run that checks nothing: axe's own version must be the
  // installed one and at least one rule must have passed before an empty
  // violation list means anything.
  expect(results.testEngine.name).toBe('axe-core');
  expect(results.testEngine.version).toBe(axe.version);
  expect(results.passes.length).toBeGreaterThan(0);
  expect(summarizeViolations(results.violations)).toEqual([]);
}

test('axe: the harness reports a known violation', async () => {
  const broken = document.createElement('div');
  broken.innerHTML = '<img src="missing.png">';
  document.body.append(broken);
  try {
    const results = await axe.run(broken, AXE_OPTIONS);
    expect(results.violations.map((violation) => violation.id)).toContain('image-alt');
  } finally {
    broken.remove();
  }
});

test('axe: the default sender render has no violations', async () => {
  const view = await render(createElement(QrStreamSender, { accept: '.json' }));
  await expectNoAxeViolations(view);
});

test('axe: the running sender render has no violations', async () => {
  h.writer.writer = { k: 40 };
  const view = await render(createElement(QrStreamSender, {}));
  await clickButton(view, 'Start stream');
  await expectNoAxeViolations(view);
});

test('axe: the default receiver render has no violations', async () => {
  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  await expectNoAxeViolations(view);
});

test('axe: the receiver wrong-key panel has no violations', async () => {
  h.camera.devices = [device('cam1', 'Back camera'), device('cam2', 'Front camera')];
  h.camera.activeId = 'cam1';
  h.camera.zoom = { min: 1, max: 4, step: 0.1 };
  h.camera.zoomValue = 2;
  h.reader.wrongKey = true;
  h.reader.error = new WrongKeyError();
  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  await expectNoAxeViolations(view);
});

test('axe: the completed receiver render has no violations', async () => {
  h.reader.result = { data: new Uint8Array([1, 2, 3]), meta: { filename: 'report.json' } };
  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  await expectNoAxeViolations(view);
});

test('axe: a recoverable camera failure render has no violations', async () => {
  h.camera.error = new CameraError('CAMERA_PERMISSION_DENIED', 'Camera permission was denied.');
  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  await expectNoAxeViolations(view);
});

// --- keyboard --------------------------------------------------------------
const normalize = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

/** A stable name for the focused element, preferring its associated label. */
function describeFocus(element: Element | null): string {
  if (!(element instanceof HTMLElement) || element === document.body) return 'body';
  const tag = element.tagName.toLowerCase();
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
    const label = element.labels?.[0];
    // A wrapping label also contains the control's own options/text; its first
    // element child is the visible caption. An explicit `for=` label holds only
    // the caption already.
    const caption = normalize(
      label !== undefined && label.contains(element) ? label.firstElementChild?.textContent : label?.textContent,
    );
    if (caption) return `${tag}:${caption}`;
  }
  return `${tag}:${normalize(element.getAttribute('aria-label') ?? element.textContent)}`;
}

async function tabOrder(limit: number): Promise<string[]> {
  const user = userEvent.setup({ document });
  const order: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    await act(async () => {
      await user.tab();
    });
    order.push(describeFocus(document.activeElement));
  }
  return order;
}

test('keyboard: the sender exposes its controls in DOM order with labels', async () => {
  h.writer.writer = { k: 40 };
  await render(createElement(QrStreamSender, { accept: '.json' }));

  expect(await tabOrder(4)).toEqual([
    'button:Start stream',
    'input:File — .json',
    'select:Density',
    'input:Passphrase — optional',
  ]);
});

test('keyboard: the running sender exposes the speed range before the stop button in DOM order', async () => {
  h.writer.writer = { k: 40 };
  const view = await render(createElement(QrStreamSender, {}));
  await clickButton(view, 'Start stream');

  const order = await tabOrder(3);
  // The slider is rendered above the primary action while running, so it is
  // the first stop; the estimate depends on k and the preset, so only the
  // label prefix is asserted.
  expect(order[0]).toMatch(/^input:Speed — 12 fps · ~\d+ s to receive$/);
  expect(order[1]).toBe('button:Stop stream');
  expect(order[2]).toBe('body');
});

// jsdom never applies the browser's "closed <details> hides its content" rule,
// so a tab walk keeps going into a closed panel. The default-state assertion is
// limited to the first stop, which is accurate in both engines.
test('keyboard: nothing precedes the diagnostics toggle in the default receiver', async () => {
  await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  expect(await tabOrder(1)).toEqual(['summary:Cameras reported by this browser (0)']);
});

test('keyboard: an opened diagnostics panel puts rescan after its toggle', async () => {
  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  const details = view.querySelector('details');
  expect(details).not.toBeNull();
  details!.open = true;

  expect(await tabOrder(2)).toEqual(['summary:Cameras reported by this browser (0)', 'button:Rescan cameras']);
});

test('keyboard: receiver camera, zoom, and unlock controls are reachable in DOM order', async () => {
  h.camera.devices = [device('cam1', 'Back camera'), device('cam2', 'Front camera')];
  h.camera.activeId = 'cam1';
  h.camera.zoom = { min: 1, max: 4, step: 0.1 };
  h.camera.zoomValue = 2;
  h.reader.wrongKey = true;
  h.reader.error = new WrongKeyError();
  await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));

  expect(await tabOrder(7)).toEqual([
    'button:Switch camera',
    'select:Camera',
    'input:Zoom — 2.0×',
    'input:Passphrase',
    'button:Unlock',
    'summary:Cameras reported by this browser (2)',
    'button:Rescan cameras',
  ]);
});

test('every form control is associated with a non-empty label', async () => {
  h.writer.writer = { k: 40 };
  const idle = await render(createElement(QrStreamSender, { accept: '.json' }));
  const idleControls = [...idle.querySelectorAll('input, select')];
  expect(idleControls.length).toBe(3);

  for (const control of idleControls) {
    const labels = (control as HTMLInputElement).labels;
    expect(labels, `${control.outerHTML} has no label`).not.toBeNull();
    expect(labels?.length).toBeGreaterThan(0);
    expect(normalize(labels?.[0]?.textContent), control.outerHTML).not.toBe('');
  }

  await clickButton(idle, 'Start stream');
  const range = idle.querySelector('input[type="range"]') as HTMLInputElement;
  expect(normalize(range.labels?.[0]?.textContent)).toMatch(/^Speed — 12 fps · ~\d+ s to receive$/);

  h.camera.devices = [device('cam1', 'Back camera'), device('cam2', 'Front camera')];
  h.camera.activeId = 'cam1';
  h.camera.zoom = { min: 1, max: 4, step: 0.1 };
  h.camera.zoomValue = 2;
  const receiver = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  const receiverControls = [...receiver.querySelectorAll('input, select')];
  expect(receiverControls.length).toBe(2);

  for (const control of receiverControls) {
    const labels = (control as HTMLInputElement).labels;
    expect(normalize(labels?.[0]?.textContent), control.outerHTML).not.toBe('');
  }
});

test('every button and the QR canvas has an accessible name', async () => {
  h.writer.writer = { k: 40 };
  const sender = await render(createElement(QrStreamSender, {}));
  await clickButton(sender, 'Start stream');
  for (const button of sender.querySelectorAll('button')) {
    expect(normalize(button.textContent), button.outerHTML).not.toBe('');
  }
  const canvas = sender.querySelector('canvas');
  expect(canvas?.getAttribute('role')).toBe('img');
  expect(canvas?.getAttribute('aria-label')).toBe('QR stream');

  h.camera.devices = [device('cam1', 'Back camera'), device('cam2', 'Front camera')];
  h.camera.activeId = 'cam1';
  h.reader.wrongKey = true;
  h.reader.error = new WrongKeyError();
  const receiver = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  for (const button of receiver.querySelectorAll('button')) {
    expect(normalize(button.textContent), button.outerHTML).not.toBe('');
  }
  expect(receiver.querySelector('video')?.getAttribute('aria-label')).toBe('Camera preview');
});

test('an error is an alert that announces without stealing focus from the retry field', async () => {
  h.reader.wrongKey = true;
  h.reader.error = new WrongKeyError();
  const view = await render(createElement(QrStreamReceiver, { decoder: stubDecoder }));

  const alert = view.querySelector('[role="alert"]');
  expect(alert?.textContent).toBe('That passphrase does not match. Try again — no need to rescan.');
  // Announced by role, not reached by tab: the alert has no tabindex.
  expect(alert?.hasAttribute('tabindex')).toBe(false);

  const input = view.querySelector<HTMLInputElement>('input[type="password"]');
  expect(input).not.toBeNull();
  await act(async () => {
    input!.focus();
  });
  expect(document.activeElement).toBe(input);

  // The alert did not take focus, and tab continues from the field to Unlock.
  expect(await tabOrder(1)).toEqual(['button:Unlock']);
});
