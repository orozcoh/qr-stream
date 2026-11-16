import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/**
 * Minimal surface of the built core entry point (`dist/index.js`).
 *
 * The spec imports the *built* bundle at runtime rather than the source tree:
 * the point is to prove the artifact this package publishes can read a packet
 * the browser actually painted, not just that the source can.
 */
interface BuiltCoreReader {
  add(packet: Uint8Array): string;
  progress(): { solved: number; k: number };
  result(passphrase?: string): Promise<{ data: Uint8Array; meta: { filename: string } } | null>;
}

interface BuiltCore {
  createQrStreamReader(): BuiltCoreReader;
}

/** Resolved at runtime so `pnpm typecheck` does not need `dist/` to exist. */
async function loadBuiltCore(): Promise<BuiltCore> {
  const url = new URL('../../dist/index.js', import.meta.url).href;
  return (await import(url)) as BuiltCore;
}

const FIXTURE = fileURLToPath(new URL('./fixtures/tiny.json', import.meta.url));

/** Decode a PNG data URL into the raw packet bytes carried by the QR. */
function decodeFrame(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const png = PNG.sync.read(Buffer.from(base64, 'base64'));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {
    inversionAttempts: 'dontInvert',
  });
  expect(result, 'jsQR found no QR code in the painted canvas').not.toBeNull();
  return Uint8Array.from(result?.binaryData ?? []);
}

test('the sender paints a real QR frame the built reader reassembles', async ({ page }) => {
  const fixture = readFileSync(FIXTURE);

  await page.goto('/');
  await page.getByTestId('send').click();
  await expect(page.locator('dialog.app-modal')).toBeVisible();

  // The demo's stage is min(70vw, 420px, 50dvh). Widen it so the painted bitmap
  // has more pixels per module than the viewport would give: the Node decoder
  // then reads the same pixels a camera would, without depending on layout.
  await page.addStyleTag({ content: '.qrs__stage { width: 840px !important; }' });

  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
  await page.locator('.qrs__select').selectOption('fast');

  const start = page.getByRole('button', { name: /start stream/i });
  await expect(start).toBeEnabled();
  await start.click();

  const canvas = page.locator('.qrs__canvas');
  const grab = async (): Promise<string> =>
    canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));

  // A fresh canvas is 300x150; the renderer sizes it to a square bitmap on the
  // first paint, so "square and larger than the default" means a real frame.
  await expect
    .poll(async () =>
      canvas.evaluate((element) => {
        const bitmap = element as HTMLCanvasElement;
        return bitmap.width === bitmap.height && bitmap.width > 300 ? bitmap.width : 0;
      }),
    )
    .toBeGreaterThan(300);

  const firstFrame = await grab();
  const packet = decodeFrame(firstFrame);
  expect(packet.length).toBeGreaterThan(20);

  // A live stream must keep painting. Same-sized, same-version codes make this
  // a check of the render loop, not of the QR payload.
  await expect.poll(async () => (await grab()) !== firstFrame, { timeout: 15_000 }).toBe(true);

  const { createQrStreamReader } = await loadBuiltCore();
  const reader = createQrStreamReader();
  expect(reader.add(packet)).toBe('accepted');

  // The fixture is small enough that a `fast` transfer is a single source block.
  expect(reader.progress()).toEqual({ solved: 1, k: 1 });

  const result = await reader.result();
  expect(result, 'the reader did not complete from a single painted frame').not.toBeNull();
  expect(result?.meta.filename).toBe('tiny.json');
  expect(Buffer.from(result?.data ?? new Uint8Array()).equals(fixture)).toBe(true);
});
