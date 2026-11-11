import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QrStreamSender } from '../src/react/QrStreamSender';
import { QrStreamReceiver } from '../src/react/QrStreamReceiver';
import { describeAccept, matchesAccept } from '../src/react/file-accept';

const fakeFile = (name: string, type: string): File =>
  ({ name, type, size: 10 }) as unknown as File;

/** SSR never runs effects, so this factory is only here to satisfy the type. */
const stubDecoder = async () => ({ decode: async () => null });

describe('QrStreamSender', () => {
  test('renders the default title', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
    expect(html).toContain('qr-stream');
  });

  test('accepts a custom title', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, { title: 'Share a file' }));
    expect(html).toContain('Share a file');
    expect(html).not.toContain('>qr-stream<');
  });

  test('carries no tagline', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
    expect(html).not.toContain('Airgapped');
  });

  test('the QR stage is always present so starting the stream cannot shift layout', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
    expect(html).toContain('qrs__stage');
    expect(html).toContain('Choose a file to begin');
  });

  test('accepts any file type by default', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
    expect(html).not.toContain('accept=');
  });

  test('reflects an accept restriction on the picker and in the label', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, { accept: '.json' }));
    expect(html).toContain('accept=".json"');
    expect(html).toContain('Accepts .json');
  });

  test('hides the speed control before a stream is running', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
    expect(html).not.toContain('qrs__range');
    expect(html).not.toContain('to receive');
  });

  test('renders the three settings after the primary action', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
    const button = html.indexOf('Start stream');
    expect(button).toBeGreaterThan(-1);
    expect(html.indexOf('qrs__settings')).toBeGreaterThan(button);
  });
});

describe('QrStreamReceiver', () => {
  test('renders a muted inline video', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).toContain('<video');
    expect(html.toLowerCase()).toContain('playsinline');
    expect(html).toContain('muted');
  });

  test('renders without a heading unless one is given', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).not.toContain('qrs__title');
  });

  test('renders a heading when asked', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder, title: 'Receive a file' }));
    expect(html).toContain('Receive a file');
  });

  test('reports progress with an accessible value', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).toContain('<progress');
    expect(html).toContain('0 / 0 blocks');
    expect(html).toContain('aria-valuetext');
  });

  test('hides camera controls until the browser reports a choice', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).not.toContain('Switch camera');
    expect(html).not.toContain('>Camera<');
  });

  test('camera controls can be suppressed entirely', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder, cameraControls: 'hidden' }));
    expect(html).not.toContain('Switch camera');
  });
});

describe('matchesAccept', () => {
  test('accepts everything when unset', () => {
    expect(matchesAccept(fakeFile('a.txt', 'text/plain'), undefined)).toBe(true);
    expect(matchesAccept(fakeFile('a.txt', 'text/plain'), '')).toBe(true);
  });

  test('matches extensions case-insensitively', () => {
    expect(matchesAccept(fakeFile('report.JSON', ''), '.json')).toBe(true);
    expect(matchesAccept(fakeFile('report.txt', ''), '.json')).toBe(false);
  });

  test('matches a list of extensions', () => {
    expect(matchesAccept(fakeFile('data.csv', ''), '.json,.csv')).toBe(true);
  });

  test('matches an exact MIME type', () => {
    expect(matchesAccept(fakeFile('blob', 'application/json'), 'application/json')).toBe(true);
    expect(matchesAccept(fakeFile('blob', 'text/plain'), 'application/json')).toBe(false);
  });

  test('matches a MIME wildcard', () => {
    expect(matchesAccept(fakeFile('photo', 'image/png'), 'image/*')).toBe(true);
    expect(matchesAccept(fakeFile('doc', 'application/pdf'), 'image/*')).toBe(false);
  });
});

describe('describeAccept', () => {
  test('renders the restriction for helper text', () => {
    expect(describeAccept('.json')).toBe('Accepts .json');
    expect(describeAccept('.json, .csv')).toBe('Accepts .json, .csv');
  });
});
