import { expect, test, type Page } from '@playwright/test';

/**
 * Camera lifecycle in a real Chromium.
 *
 * The fake capture device means `getUserMedia` resolves with a genuine
 * `MediaStreamTrack`: `readyState === 'ended'` after stop() is the browser's own
 * statement that the hardware was released, not a mock.
 */
interface InstrumentedWindow extends Window {
  __gumCalls?: number;
  __track?: MediaStreamTrack;
}

/** Count getUserMedia calls so "does not open" is observable, not implicit. */
async function instrumentCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const instrumented = window as InstrumentedWindow;
    instrumented.__gumCalls = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints?: MediaStreamConstraints) => {
      instrumented.__gumCalls = (instrumented.__gumCalls ?? 0) + 1;
      return original(constraints);
    };
  });
}

interface CameraState {
  gumCalls: number;
  hasStream: boolean;
  trackState: string | null;
  trackKind: string | null;
  videoWidth: number;
}

/** Read the live stream state, falling back to the last track seen once stopped. */
async function cameraState(page: Page, selector: string): Promise<CameraState> {
  return page.evaluate((videoSelector) => {
    const instrumented = window as InstrumentedWindow;
    const video = document.querySelector(videoSelector) as HTMLVideoElement | null;
    const stream = (video?.srcObject as MediaStream | null) ?? null;
    // Prefer the live stream; after stop() the stashed track is the evidence
    // that the one that used to be live is now ended.
    const track = stream?.getVideoTracks()[0] ?? instrumented.__track ?? null;
    return {
      gumCalls: instrumented.__gumCalls ?? 0,
      hasStream: stream !== null,
      trackState: track?.readyState ?? null,
      trackKind: track?.kind ?? null,
      videoWidth: video?.videoWidth ?? 0,
    };
  }, selector);
}

/** Keep a handle on the current track so it can be inspected after release. */
async function stashTrack(page: Page, selector: string): Promise<void> {
  await page.evaluate((videoSelector) => {
    const video = document.querySelector(videoSelector) as HTMLVideoElement;
    const stream = video.srcObject as MediaStream;
    (window as InstrumentedWindow).__track = stream.getVideoTracks()[0];
  }, selector);
}

const HARNESS_CAMERA = '[data-testid="camera"]';

test.beforeEach(async ({ page }) => {
  await instrumentCamera(page);
});

test('the camera stays closed until the hook is enabled', async ({ page }) => {
  await page.goto('/e2e.html');
  await expect(page.getByTestId('enabled')).toHaveText('false');
  await expect(page.getByTestId('error')).toHaveText('');

  // `enabled: false` is a negative claim: nothing to await, so give the
  // auto-open effect a real chance to run and then assert it did not.
  await page.waitForTimeout(500);

  const state = await cameraState(page, HARNESS_CAMERA);
  expect(state.gumCalls).toBe(0);
  expect(state.hasStream).toBe(false);
  expect(state.trackState).toBeNull();
  await expect(page.getByTestId('ready')).toHaveText('false');
});

test('enabling opens the camera, stop ends the track, start reopens it', async ({ page }) => {
  await page.goto('/e2e.html');
  await page.getByTestId('toggle-enabled').click();

  await expect(page.getByTestId('enabled')).toHaveText('true');
  await expect(page.getByTestId('ready')).toHaveText('true');

  const opened = await cameraState(page, HARNESS_CAMERA);
  expect(opened.gumCalls).toBe(1);
  expect(opened.hasStream).toBe(true);
  expect(opened.trackKind).toBe('video');
  expect(opened.trackState).toBe('live');
  // Frames are flowing: the fake device feeds a real video track.
  await expect.poll(async () => (await cameraState(page, HARNESS_CAMERA)).videoWidth).toBeGreaterThan(0);

  await stashTrack(page, HARNESS_CAMERA);
  await page.getByTestId('stop').click();

  await expect(page.getByTestId('ready')).toHaveText('false');
  await expect.poll(async () => (await cameraState(page, HARNESS_CAMERA)).hasStream).toBe(false);
  await expect.poll(async () => (await cameraState(page, HARNESS_CAMERA)).trackState).toBe('ended');

  await page.getByTestId('start').click();
  await expect(page.getByTestId('ready')).toHaveText('true');
  await expect.poll(async () => (await cameraState(page, HARNESS_CAMERA)).trackState).toBe('live');

  const reopened = await cameraState(page, HARNESS_CAMERA);
  expect(reopened.gumCalls).toBe(2);
  expect(reopened.hasStream).toBe(true);

  // Disabling is the other half of the `enabled` contract: it releases too.
  await stashTrack(page, HARNESS_CAMERA);
  await page.getByTestId('toggle-enabled').click();
  await expect(page.getByTestId('enabled')).toHaveText('false');
  await expect.poll(async () => (await cameraState(page, HARNESS_CAMERA)).trackState).toBe('ended');
  await expect.poll(async () => (await cameraState(page, HARNESS_CAMERA)).hasStream).toBe(false);

  // The reopened track is ended too: disabling releases it just like stop().
  expect(await page.evaluate(() => (window as InstrumentedWindow).__track?.readyState ?? null)).toBe('ended');
});

test('opening the receiver modal starts the camera and closing it releases it', async ({ page }) => {
  await page.goto('/');
  expect((await cameraState(page, '.qrs__video')).gumCalls).toBe(0);

  await page.getByTestId('receive').click();
  const video = page.locator('.qrs__video');
  await expect(video).toBeVisible();

  await expect.poll(async () => (await cameraState(page, '.qrs__video')).gumCalls).toBe(1);
  await expect.poll(async () => (await cameraState(page, '.qrs__video')).videoWidth).toBeGreaterThan(0);

  const live = await cameraState(page, '.qrs__video');
  expect(live.hasStream).toBe(true);
  expect(live.trackState).toBe('live');

  await stashTrack(page, '.qrs__video');
  await page.keyboard.press('Escape');

  await expect(video).toBeHidden();
  await expect
    .poll(async () => page.evaluate(() => (window as InstrumentedWindow).__track?.readyState ?? null))
    .toBe('ended');
  // Unmounting the receiver is what releases the camera; no gUM was retried.
  expect((await cameraState(page, '.qrs__video')).gumCalls).toBe(1);
});
