import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const CORE_DIR = fileURLToPath(new URL('../src/core', import.meta.url));

/** Globals the core must never reach for: it has to run in Node for tests. */
const FORBIDDEN = [
  'window.',
  'document.',
  'navigator.',
  'HTMLCanvasElement',
  'HTMLElement',
  'localStorage',
  'requestAnimationFrame',
];

describe('core purity', () => {
  test('src/core never touches the DOM', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(CORE_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(join(CORE_DIR, file), 'utf8');
      for (const token of FORBIDDEN) {
        if (text.includes(token)) offenders.push(`${file} uses ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
