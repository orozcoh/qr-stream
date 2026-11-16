import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts?: Record<string, string>;
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

  test('the React peer range includes 18', () => {
    expect(pkg.peerDependencies?.react).toMatch(/>=\s*18/);
  });

  test('package.json is exported for tooling', () => {
    expect(pkg.exports?.['./package.json']).toBe('./package.json');
  });

  test('the React 18 typecheck script exists', () => {
    expect(pkg.scripts?.['typecheck:react18']).toBeTruthy();
  });

  test('the published files are the built output only', () => {
    // `files` is the pack allowlist: shipping `src/` or `tests/` would leak
    // sources and double the tarball.
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.files?.some((entry) => /^(src|tests|demo)\b/.test(entry))).toBe(false);
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

describe('API report', () => {
  // One committed report per public entry: the reports are the frozen surface,
  // and `pnpm api:check` fails when a declaration drifts from them.
  const reports: Record<string, string> = {
    '.': 'qr-stream.api.md',
    './browser': 'qr-stream-browser.api.md',
    './qr': 'qr-stream-qr.api.md',
    './react': 'qr-stream-react.api.md',
    './browser/zxing': 'qr-stream-zxing.api.md',
  };

  test('every public entry has a committed API report', () => {
    expect(
      Object.keys(pkg.exports ?? {})
        .filter((entry) => entry !== './package.json')
        .sort(),
    ).toEqual(Object.keys(reports).sort());
    for (const report of Object.values(reports)) {
      expect(existsSync(join(root, 'etc', report)), `etc/${report} is missing`).toBe(true);
    }
  });

  test('the report scripts exist and run API Extractor', () => {
    expect(pkg.scripts?.['api:build']).toContain('api-extractor run --local');
    expect(pkg.scripts?.['api:check']).toContain('api-extractor run');
    expect(pkg.scripts?.['api:check']).not.toContain('--local');
  });
});
