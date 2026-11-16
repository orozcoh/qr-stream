import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const docsPath = fileURLToPath(new URL('../docs/integration.md', import.meta.url));
const text = readFileSync(docsPath, 'utf8');

// A drift guard, not documentation coverage: these exact terms are the ones a
// host needs to avoid the silent offline failure and the stale lifecycle API.
describe('integration guide', () => {
  test('covers the silent offline failure', () => {
    for (const term of ['globPatterns', 'wasm-unsafe-eval', 'wasmUrl', 'zxing_reader', 'createDecoder']) {
      expect(text).toContain(term);
    }
  });

  test('covers the headless lifecycle, limits, and error recovery', () => {
    const terms = [
      'writer.version',
      'enabled',
      'start()',
      'stop()',
      'maxWireBytes',
      'maxInputBytes',
      'React 18',
      'recovery',
      'WRONG_PASSPHRASE',
      'isQrStreamError',
    ];
    for (const term of terms) {
      expect(text).toContain(term);
    }
  });
});
