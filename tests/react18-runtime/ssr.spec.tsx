// @vitest-environment node
import { QrStreamReceiver, QrStreamSender } from '@orozcoh/qr-stream/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

// This is the built public entry, so the module-scope `ensureQrStreamStyles()`
// calls have already run against a Node global with no document. SSR must
// no-op the injection instead of throwing; the root suite covers the source
// entry pre-build, this smoke covers what consumers actually import.
const stubDecoder = async () => ({ decode: async () => null });

test('the built public React entry renders to static markup without a DOM', () => {
  expect(typeof document).toBe('undefined');

  const sender = renderToStaticMarkup(createElement(QrStreamSender, {}));
  expect(sender).toContain('qrs');
  expect(sender).toContain('qr-stream');
  expect(sender).toContain('Choose a file to begin');

  const receiver = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
  expect(receiver).toContain('qrs');
  expect(receiver).toContain('<video');
});
