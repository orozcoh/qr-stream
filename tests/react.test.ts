import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { QrStreamError } from '../src/core/errors';
import { DownloadControl } from '../src/react/DownloadControl';
import { ErrorText } from '../src/react/ErrorText';
import { describeAcceptTypes, matchesAccept } from '../src/react/file-accept';
import { QrStreamReceiver } from '../src/react/QrStreamReceiver';
import { QrStreamSender } from '../src/react/QrStreamSender';
import {
  DEFAULT_QR_STREAM_STRINGS,
  formatQrString,
  resolveQrStreamStrings,
  type QrStreamStrings,
} from '../src/react/strings';
import {
  coverageGaps,
  expectNoDefaultCopy,
  expectSentinels,
  sentinelStrings,
  sentinelValue,
  SSR_RECEIVER_KEYS,
  SSR_SENDER_KEYS,
  STATE_KEYS,
} from './helpers/i18n';

const fakeFile = (name: string, type: string): File => ({ name, type, size: 10 }) as unknown as File;

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
    expect(html).toContain('— .json');
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

  test('custom strings replace the sender labels and drop the defaults', () => {
    const html = renderToStaticMarkup(
      createElement(QrStreamSender, {
        strings: { start: 'Enviar', stop: 'Detener', chooseFile: 'Elige un archivo', file: 'Archivo' },
      }),
    );
    expect(html).toContain('Enviar');
    expect(html).toContain('Elige un archivo');
    expect(html).toContain('Archivo');
    expect(html).not.toContain('Start stream');
    expect(html).not.toContain('Choose a file to begin');
  });

  test('density options interpolate the name and version', () => {
    const html = renderToStaticMarkup(
      createElement(QrStreamSender, { strings: { densityOption: '{name} / v{version}' } }),
    );
    expect(html).toContain('fast / v20');
    expect(html).not.toContain('fast — v20');
  });

  test('the canvas is an image with an accessible name', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, { strings: { qrCode: 'Código QR' } }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Código QR"');
  });

  test('the passphrase input has a visible label tied to it', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Passphrase <span class="qrs__hint">— optional<\/span><\/label>/);
    expect(html).toMatch(/<input[^>]*id="[^"]+"/);
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
    const html = renderToStaticMarkup(
      createElement(QrStreamReceiver, { decoder: stubDecoder, title: 'Receive a file' }),
    );
    expect(html).toContain('Receive a file');
  });

  test('reports progress with an accessible value', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).toContain('<progress');
    expect(html).toContain('0 / 0 blocks');
    expect(html).toContain('aria-valuetext');
    expect(html).toContain('0 of 0 blocks, 0 percent');
  });

  test('hides camera controls until the browser reports a choice', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).not.toContain('Switch camera');
    expect(html).not.toContain('>Camera<');
  });

  test('camera controls can be suppressed entirely', () => {
    const html = renderToStaticMarkup(
      createElement(QrStreamReceiver, { decoder: stubDecoder, cameraControls: 'hidden' }),
    );
    expect(html).not.toContain('Switch camera');
  });

  test('custom strings replace the receiver labels', () => {
    const html = renderToStaticMarkup(
      createElement(QrStreamReceiver, {
        decoder: stubDecoder,
        strings: { progress: '{solved}/{k} bloques', progressAria: '{solved} de {k} bloques', cameraPreview: 'Vista' },
      }),
    );
    expect(html).toContain('0/0 bloques');
    expect(html).toContain('0 de 0 bloques');
    expect(html).toContain('aria-label="Vista"');
    expect(html).not.toContain('0 / 0 blocks');
    expect(html).not.toContain('Camera preview');
  });

  test('the video has an accessible name', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).toContain('aria-label="Camera preview"');
  });

  test('the diagnostics table has a caption and translated headers', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).toContain('<caption');
    expect(html).toContain('Cameras reported by this browser (0)');
    expect(html).toContain('<th>Label</th>');
  });
});

describe('ErrorText', () => {
  test('formats a coded error and announces it', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorText, {
        error: new QrStreamError('INVALID_PACKET', 'bad frame'),
        formatError: (error) => `code:${error.code}`,
      }),
    );
    expect(html).toContain('code:INVALID_PACKET');
    expect(html).toContain('role="alert"');
    expect(html).toContain('qrs__error');
  });

  test('falls back to the error message', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorText, { error: new QrStreamError('INVALID_PACKET', 'bad frame') }),
    );
    expect(html).toContain('bad frame');
  });

  test('renders nothing without an error', () => {
    expect(renderToStaticMarkup(createElement(ErrorText, { error: null }))).toBe('');
  });
});

describe('DownloadControl', () => {
  test('is a single anchor, not an anchor wrapping a button', () => {
    const html = renderToStaticMarkup(
      createElement(DownloadControl, { url: 'blob:test', filename: 'a.json', label: 'Save file' }),
    );
    expect(html).toContain('<a');
    expect(html).toContain('href="blob:test"');
    expect(html).toContain('download="a.json"');
    expect(html).toContain('qrs__button qrs__button--primary');
    expect(html).not.toContain('<button');
  });
});

describe('strings', () => {
  test('formats numbers and strings', () => {
    expect(formatQrString('{solved}/{k} blocks', { solved: 3, k: 10 })).toBe('3/10 blocks');
  });

  test('treats replacement patterns in a value as literal text', () => {
    expect(formatQrString('{name}', { name: '$& $1 $$ $`' })).toBe('$& $1 $$ $`');
  });

  test('leaves unknown placeholders intact', () => {
    expect(formatQrString('{known} {missing}', { known: 'x' })).toBe('x {missing}');
  });

  test('treats an undefined override as absent', () => {
    expect(resolveQrStreamStrings({ start: undefined, stop: 'Detener' })).toMatchObject({
      start: 'Start stream',
      stop: 'Detener',
    });
  });

  // The sentinel gate below cannot compare markup with a braced template: a
  // component never renders braces. This table fixes the English a templated
  // default actually produces, and the sentinel test asserts those literal
  // chunks are gone when every key is overridden.
  const TEMPLATE_CASES: readonly {
    key: keyof QrStreamStrings;
    values: Readonly<Record<string, string | number>>;
    expected: string;
  }[] = [
    {
      key: 'speed',
      values: { fps: 12, estimate: '~34 s' },
      expected: 'Speed — 12 fps · ~34 s to receive',
    },
    { key: 'accepts', values: { types: '.json, .csv' }, expected: '— .json, .csv' },
    {
      key: 'fileTypeRejected',
      values: { name: 'notes.txt' },
      expected: 'notes.txt is not an accepted file type here.',
    },
    { key: 'fileTooLarge', values: { kb: 4096, limit: 1024 }, expected: 'That file is 4096 KB. The limit is 1024 KB.' },
    { key: 'densityOption', values: { name: 'fast', version: 20 }, expected: 'fast — v20' },
    { key: 'zoom', values: { value: '2.0' }, expected: 'Zoom — 2.0×' },
    { key: 'verified', values: { filename: 'a.json' }, expected: 'a.json — SHA-256 verified' },
    {
      key: 'progress',
      values: { solved: 3, k: 10, percent: 30, rate: 12 },
      expected: '3 / 10 blocks · 30% · 12 frames/s',
    },
    {
      key: 'progressAria',
      values: { solved: 3, k: 10, percent: 30 },
      expected: '3 of 10 blocks, 30 percent',
    },
    {
      key: 'diagnostics',
      values: { count: 2 },
      expected: 'Cameras reported by this browser (2)',
    },
    {
      key: 'activeCamera',
      values: { label: 'Back', width: 640, height: 480, fps: 30, focus: 'continuous' },
      expected: 'Active: Back · 640×480 @ 30 fps · focus continuous',
    },
  ];

  test('the template table covers every templated default', () => {
    const templated = Object.keys(DEFAULT_QR_STREAM_STRINGS).filter((key) =>
      (DEFAULT_QR_STREAM_STRINGS[key as keyof QrStreamStrings] as string).includes('{'),
    );
    expect(TEMPLATE_CASES.map(({ key }) => key).sort()).toEqual(templated.sort());
  });

  for (const { key, values, expected } of TEMPLATE_CASES) {
    test(`the ${key} default renders "${expected}"`, () => {
      expect(formatQrString(DEFAULT_QR_STREAM_STRINGS[key], values)).toBe(expected);
    });
  }

  test('every string key is wired into a packaged component', () => {
    const sources = ['../src/react/QrStreamSender.tsx', '../src/react/QrStreamReceiver.tsx']
      .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
      .join('\n');
    for (const key of Object.keys(DEFAULT_QR_STREAM_STRINGS)) {
      expect(sources, `unused string key: ${key}`).toContain(`text.${key}`);
    }
  });

  test('the sentinel gate covers every string key', () => {
    expect(coverageGaps([...SSR_SENDER_KEYS, ...SSR_RECEIVER_KEYS, ...STATE_KEYS])).toEqual([]);
  });

  test('the default SSR sender renders only sentinel copy', () => {
    const strings = sentinelStrings();
    const sender = renderToStaticMarkup(createElement(QrStreamSender, { strings, accept: '.json' }));

    expectNoDefaultCopy(sender);
    expectSentinels(sender, SSR_SENDER_KEYS);
  });

  test('the default SSR receiver renders only sentinel copy', () => {
    const strings = sentinelStrings();
    const receiver = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder, strings }));

    expectNoDefaultCopy(receiver);
    expectSentinels(receiver, SSR_RECEIVER_KEYS);
    // The diagnostics caption and the table headers are part of the same gate.
    expect(receiver).toContain(`<caption class="qrs__sr-only">`);
    expect(receiver).toContain(`<th>${sentinelValue('tableLabel')}</th>`);
    expect(receiver).toContain('aria-valuetext');
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

  test('matches everything for */*', () => {
    expect(matchesAccept(fakeFile('blob', 'application/octet-stream'), '*/*')).toBe(true);
  });
});

describe('describeAcceptTypes', () => {
  test('renders the restriction list for helper text', () => {
    expect(describeAcceptTypes('.json')).toBe('.json');
    expect(describeAcceptTypes('.json, .csv')).toBe('.json, .csv');
  });
});
