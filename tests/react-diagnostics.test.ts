import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { QrStreamReceiver } from '../src/react/QrStreamReceiver';

// The diagnostics block only renders once the camera hook reports a live
// device. Stub it so the rendered `width×height` text is asserted directly:
// a JSX line break between `{width}`, `×` and `{height}` would insert a space.
vi.mock('../src/react/useCameraReader', () => ({
  useCameraReader: () => ({
    videoRef: { current: null },
    devices: [],
    activeId: null,
    select: async () => undefined,
    cycle: async () => undefined,
    rescan: async () => undefined,
    switching: false,
    error: null,
    diagnostics: {
      devices: [],
      active: {
        deviceId: 'cam1',
        label: 'Back Camera',
        settings: { width: 640, height: 480, frameRate: 30 } as MediaTrackSettings,
        capabilities: { focusMode: ['continuous'] },
      },
    },
    zoom: null,
    zoomValue: 0,
    setZoom: async () => undefined,
  }),
}));

const stubDecoder = async () => ({ decode: async () => null });

describe('QrStreamReceiver diagnostics', () => {
  test('renders width×height with no inserted space', () => {
    const html = renderToStaticMarkup(createElement(QrStreamReceiver, { decoder: stubDecoder }));
    expect(html).toContain('640×480');
    expect(html).not.toContain('640× 480');
    expect(html).toContain('Active: Back Camera · 640×480 @ 30 fps · focus continuous');
  });
});
