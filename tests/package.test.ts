import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

describe('package metadata', () => {
  test('the QR encoder is a runtime dependency', () => {
    // The sender imports it at runtime; shipping it as a dev dependency makes
    // the published package fail to import.
    expect(pkg.dependencies?.['qrcode-generator']).toBeTruthy();
    expect(pkg.devDependencies?.['qrcode-generator']).toBeUndefined();
  });

  test('the decoder is an optional peer so consumers choose its cost', () => {
    expect(pkg.dependencies?.['zxing-wasm']).toBeUndefined();
    expect(pkg.peerDependencies?.['zxing-wasm']).toBeTruthy();
    expect(pkg.peerDependenciesMeta?.['zxing-wasm']?.optional).toBe(true);
  });

  test('nothing under src/browser imports a decoder except the decoder folder', () => {
    const browserDir = join(root, 'src', 'browser');
    const offenders: string[] = [];
    for (const entry of readdirSync(browserDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const text = readFileSync(join(browserDir, entry.name), 'utf8');
      if (text.includes('zxing-wasm')) offenders.push(entry.name);
    }
    expect(offenders).toEqual([]);
  });

  test('the core never depends on the QR encoder', () => {
    const coreDir = join(root, 'src', 'core');
    const offenders: string[] = [];
    for (const file of readdirSync(coreDir)) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(join(coreDir, file), 'utf8');
      if (/from\s+['"][^'"]*\/qr\//.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
