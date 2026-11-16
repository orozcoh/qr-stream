import { expect, test } from '@playwright/test';

/**
 * Offline behaviour of the built demo.
 *
 * This is the claim the whole package exists for: a phone that has loaded the
 * app once keeps working in an airgap. It runs against the production build
 * (plus the test-only harness page), served by `vite preview`, and demands the
 * real service worker, the real precache, and a real network outage.
 */
test('the service worker precaches the decoder and the app survives offline', async ({ context, page }) => {
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

  // Strongest available proof without a QR video fixture: the shipped receiver
  // instantiates ZXing from the precached wasm while offline and reaches a
  // live camera stream. A wasm cache miss would fail the decoder and leave the
  // preview with no frames.
  await page.getByTestId('receive').click();
  const video = page.locator('.qrs__video');
  await expect(video).toBeVisible();
  await expect
    .poll(async () => video.evaluate((element) => (element as HTMLVideoElement).videoWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect(page.locator('.qrs__error')).toHaveCount(0);
});
