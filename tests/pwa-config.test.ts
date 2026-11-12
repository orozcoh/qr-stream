import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const configPath = fileURLToPath(new URL('../demo/vite.config.ts', import.meta.url));
const config = readFileSync(configPath, 'utf8');
const headersPath = fileURLToPath(new URL('../demo/public/_headers', import.meta.url));
const headers = readFileSync(headersPath, 'utf8');

describe('demo PWA configuration', () => {
  test('precaches wasm so the receiver works in the airgap', () => {
    // Without this the receiver works online and fails exactly where it matters:
    // on two devices with no network.
    expect(config).toContain('wasm');
    expect(config).toMatch(/globPatterns/);
  });

  test('the service worker is registered for offline use', () => {
    expect(config).toContain('VitePWA');
    expect(config).toContain('autoUpdate');
  });

  test('serves a content security policy and HSTS', () => {
    expect(headers).toContain('Content-Security-Policy:');
    expect(headers).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(headers).toContain('Strict-Transport-Security:');
  });
});
