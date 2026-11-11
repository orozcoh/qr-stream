import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QrStreamSender } from '../src/react/QrStreamSender';
import { QrStreamReceiver } from '../src/react/QrStreamReceiver';

describe('react components', () => {
  test('the sender renders its controls without touching the DOM', () => {
    const html = renderToStaticMarkup(createElement(QrStreamSender, {}));
    expect(html).toContain('JSON file');
    expect(html).toContain('Density');
    expect(html).toContain('canvas');
  });

  test('the receiver renders a muted inline video element', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, {}));
    expect(html).toContain('<video');
    expect(html.toLowerCase()).toContain('playsinline');
    expect(html).toContain('muted');
    expect(html).toContain('<progress');
    expect(html).toContain('0/0 blocks');
  });

  test('the receiver hides camera controls until it knows there is a choice', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, {}));
    expect(html).not.toContain('>Camera<');
  });
});
