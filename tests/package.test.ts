import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('package metadata', () => {
  test('runtime dependencies are declared as dependencies, not devDependencies', () => {
    // The built output imports these at runtime. Shipping them as dev
    // dependencies makes the published package fail to import.
    const runtime = ['qrcode-generator', 'zxing-wasm'];
    for (const name of runtime) {
      expect(pkg.dependencies?.[name], `${name} must be a runtime dependency`).toBeTruthy();
      expect(pkg.devDependencies?.[name], `${name} must not be dev-only`).toBeUndefined();
    }
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
