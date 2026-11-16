import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import zxingUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';
import { useCameraReader } from '@orozcoh/qr-stream/react';

/**
 * Test-only camera harness.
 *
 * `QrStreamReceiver` keeps the camera lifecycle internal: it always opens on
 * mount. Playwright needs to observe `enabled`, the manual start/stop pair and
 * the track state, so this page drives `useCameraReader` directly with the same
 * production decoder. Built only for the end-to-end run (`QR_STREAM_E2E=1`).
 */
const zxingDecoder = () => createZXingDecoder({ wasmUrl: zxingUrl });

function CameraHarness() {
  const [enabled, setEnabled] = useState(false);
  const { videoRef, start, stop, ready, starting, error } = useCameraReader({
    createDecoder: zxingDecoder,
    enabled,
  });

  return (
    <main style={{ display: 'grid', gap: 12, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>camera harness</h1>

      <p style={{ margin: 0 }}>
        enabled: <output data-testid="enabled">{String(enabled)}</output> | ready:{' '}
        <output data-testid="ready">{String(ready)}</output> | starting:{' '}
        <output data-testid="starting">{String(starting)}</output> | error:{' '}
        <output data-testid="error">{error?.message ?? ''}</output>
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" data-testid="toggle-enabled" onClick={() => setEnabled((value) => !value)}>
          {enabled ? 'enabled (click to disable)' : 'disabled (click to enable)'}
        </button>
        <button type="button" data-testid="start" onClick={() => void start()}>
          start
        </button>
        <button type="button" data-testid="stop" onClick={() => stop()}>
          stop
        </button>
      </div>

      {/* 640x480 keeps the fake device's synthetic frames small. */}
      <video
        ref={videoRef}
        data-testid="camera"
        width={640}
        height={480}
        playsInline
        muted
        style={{ background: '#000' }}
      />
    </main>
  );
}

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root');

createRoot(container).render(<CameraHarness />);
