import { expect, test } from '@playwright/test';

/**
 * Known payload for the offline receive proof; must match `RECEIVE_TEXT` in
 * `demo/e2e.tsx`. It is written out here on purpose: the spec knows the bytes
 * before the page runs, so the assertion is not the harness grading itself.
 */
const EXPECTED = '{"offline":"receive","task":13}';

/**
 * Offline behaviour of the built demo.
 *
 * This is the claim the whole package exists for: a phone that has loaded the
 * app once keeps working in an airgap. It runs against the production build
 * (plus the test-only harness page), served by `vite preview`, and demands the
 * real service worker, the real precache, and a real network outage.
 */
test('the service worker precaches the decoder and an offline receive completes', async ({ context, page }) => {
  await page.goto('/');

  // `ready` resolves as soon as an active worker exists, which can still be
  // finishing activation on the first load.
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state ?? null;
      }),
    )
    .toBe('activated');

  const precachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });

  expect(
    precachedUrls.some((url) => url.includes('/index.html')),
    'the app shell is not precached',
  ).toBe(true);
  const cachedWasm = precachedUrls.find((url) => url.includes('zxing_reader'));
  expect(cachedWasm, 'zxing_reader.wasm is not precached').toBeTruthy();

  // The URL the app itself requests: no workbox revision query.
  const wasmPath = new URL(cachedWasm as string).pathname;

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // The shell came from the cache, and the page is really offline.
  await expect(page.getByTestId('send')).toBeVisible();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const wasmResponse = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    return { ok: response.ok, status: response.status, byteLength: bytes.byteLength };
  }, wasmPath);
  expect(wasmResponse.ok, `cached wasm fetch failed with ${wasmResponse.status}`).toBe(true);
  expect(wasmResponse.byteLength).toBeGreaterThan(100_000);

  // A receive that actually completes offline. The harness serves a canvas
  // painted with a known `k = 1` packet as the camera; the shipped receiver
  // loads ZXing from the precache, decodes that frame, and the fountain reader
  // reassembles and SHA-256-verifies the payload. Nothing here touches the
  // network, so a wasm that instantiates but fails to decode would fail this.
  await page.goto('/e2e.html#receive');
  await expect(page.getByTestId('harness-mode')).toHaveText('receive');

  await expect(page.getByTestId('received')).toHaveText(EXPECTED, { timeout: 30_000 });
  await expect(page.getByTestId('received-filename')).toHaveText('offline.json');

  // The receiver's own verified state, not a harness echo. `<output>` also has
  // the implicit `status` role, so target the receiver's paragraph directly.
  await expect(page.locator('p.qrs__meta[role="status"]')).toHaveText('offline.json — SHA-256 verified');
  await expect(page.getByTestId('expected')).toHaveText(EXPECTED);
  await expect(page.locator('.qrs__error')).toHaveCount(0);

  // Byte equality against the payload the spec knew before the page loaded.
  const delivered = await page.evaluate(
    () => (window as { __qrReceived?: { bytes: number[] } }).__qrReceived?.bytes ?? null,
  );
  expect(delivered).toEqual(Array.from(new TextEncoder().encode(EXPECTED)));

  // The reader solved every source block, so progress reached k / k.
  await expect(page.locator('.qrs__progress')).toHaveAttribute('aria-valuetext', '1 of 1 blocks, 100 percent');
});
