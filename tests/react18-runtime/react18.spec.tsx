import { createRequire } from 'node:module';
import { useCameraReader, type QrVideoRef } from '@orozcoh/qr-stream/react';
import { act, version } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);

// A decoder is required by the hook's type even though `enabled: false` means
// it is never constructed. This test is about the React runtime the built
// package actually hooks into, not camera I/O.
const stubDecoder = async () => ({ decode: async () => null });

function Probe({ capture }: { capture(ref: QrVideoRef): void }) {
  const { videoRef } = useCameraReader({ createDecoder: stubDecoder, enabled: false });
  capture(videoRef);
  // No cast: QrVideoRef must be assignable to React 18's ref prop directly.
  return <video ref={videoRef} data-testid="feed" />;
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('the built React entry runs against React 18 and attaches the video ref', async () => {
  // The whole suite shares one resolved React because `vitest.config.ts` aliases
  // every React entry point to this workspace's install. If the built package
  // resolved a second (root React 19) copy, the hook call below would throw
  // "Invalid hook call" instead of rendering.
  expect(version).toBe('18.3.1');
  // The config aliases React to exactly these installs. `react/index.js` is the
  // single client entry the Vite module graph hands both the test and the built
  // package, so no second copy can supply a different hook dispatcher.
  expect(require.resolve('react')).toContain('react@18.3.1');
  expect(require.resolve('react-dom/client')).toContain('react-dom@18.3.1');
  // The package import is the built artifact, not the TypeScript source.
  expect(import.meta.resolve('@orozcoh/qr-stream/react')).toMatch(/\/dist\/react\.js$/);

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const captured: { ref: QrVideoRef | null } = { ref: null };

  await act(async () => {
    root.render(<Probe capture={(ref) => (captured.ref = ref)} />);
  });

  if (captured.ref === null) throw new Error('the harness captured no video ref');
  expect(captured.ref.current).toBeInstanceOf(HTMLVideoElement);
  expect(captured.ref.current?.tagName).toBe('VIDEO');
  expect(container.querySelector('video')).toBe(captured.ref.current);

  act(() => root.unmount());
});
