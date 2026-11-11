import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const configPath = fileURLToPath(new URL('../demo/vite.config.ts', import.meta.url));
const config = readFileSync(configPath, 'utf8');

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
});
