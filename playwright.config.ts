import { defineConfig } from '@playwright/test';

/**
 * Browser end-to-end tests.
 *
 * These drive the built demo in a real Chromium: the sender spec decodes a
 * real canvas, the camera spec opens the fake capture device, and the PWA spec
 * reloads with the network cut. Keep this separate from Vitest: specs are
 * `*.spec.ts`, unit tests stay `*.test.ts`.
 */
const PORT = Number(process.env.E2E_PORT ?? 4174);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  // One shared server, one fake camera, no benefit from interleaving.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    // A fractional device pixel ratio would make the QR raster non-integer and
    // is exactly the blur the renderer works to avoid.
    deviceScaleFactor: 1,
    permissions: ['camera'],
    trace: 'on-first-retry',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    // `QR_STREAM_E2E=1` adds the camera harness page to the build. It is not
    // part of the production bundle; see demo/vite.config.ts.
    command: `QR_STREAM_E2E=1 pnpm demo:build && pnpm exec vite preview --config demo/vite.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
