// @vitest-environment node
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import {
  QrStreamReceiver,
  QrStreamSender,
  useCameraReader,
  useQrStreamReader,
  useQrStreamWriter,
} from '../src/react/index.js';

// The entries inject their stylesheet once at module scope. Importing them in
// Node runs that code with no `document`, so the injection must no-op instead
// of throwing during SSR or a static export.
const stubDecoder = async () => ({ decode: async () => null });

test('the React entry imports and renders without a DOM', () => {
  expect(typeof document).toBe('undefined');
  // Every exported hook is real: a module-scope side effect that touched the
  // DOM would have thrown before the test body ran.
  expect(typeof useCameraReader).toBe('function');
  expect(typeof useQrStreamReader).toBe('function');
  expect(typeof useQrStreamWriter).toBe('function');
});

test('the sender renders to static markup', () => {
  const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
  expect(html).toContain('qrs');
  expect(html).toContain('qr-stream');
  expect(html).toContain('Choose a file to begin');
});

test('the receiver renders to static markup with a stub decoder', () => {
  const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  expect(html).toContain('qrs');
  expect(html).toContain('<video');
});

test('rendering twice still does not install a stylesheet', () => {
  renderToStaticMarkup(createElement(QrStreamSender, {}));
  renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  expect(typeof document).toBe('undefined');
});
