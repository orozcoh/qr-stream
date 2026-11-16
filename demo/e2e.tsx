import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import zxingUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createQrStreamWriter } from '@orozcoh/qr-stream';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';
import { matrixToRGBA, packetToMatrix } from '@orozcoh/qr-stream/qr';
import { QrStreamReceiver, useCameraReader } from '@orozcoh/qr-stream/react';

/**
 * Test-only harness page, built only when `QR_STREAM_E2E=1`.
 *
 * - `/e2e.html` drives `useCameraReader` directly: the shipped receiver always
 *   opens on mount, so its `enabled`/start/stop lifecycle is otherwise
 *   unobservable.
 * - `/e2e.html#receive` replaces the camera with a canvas stream painted with a
 *   known `k = 1` packet and mounts the real `QrStreamReceiver`, so the offline
 *   test can prove the precached wasm decodes a frame and the reader
 *   reassembles a verified payload with no network.
 */
const zxingDecoder = () => createZXingDecoder({ wasmUrl: zxingUrl });

/** Known payload for the offline receive proof; `pwa.spec.ts` asserts the same text. */
const RECEIVE_TEXT = '{"offline":"receive","task":13}';
const RECEIVE_FILENAME = 'offline.json';

interface Received {
  text: string;
  filename: string;
  bytes: number[];
}

function CameraHarness() {
  const [enabled, setEnabled] = useState(false);
  const { videoRef, start, stop, ready, starting, error } = useCameraReader({
    createDecoder: zxingDecoder,
    enabled,
  });

  return (
    <main style={{ display: 'grid', gap: 12, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>
        camera harness <output data-testid="harness-mode">camera</output>
      </h1>

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

function OfflineReceive() {
  const [received, setReceived] = useState<Received | null>(null);

  return (
    <main style={{ display: 'grid', gap: 12, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>
        offline receive harness <output data-testid="harness-mode">receive</output>
      </h1>

      <p style={{ margin: 0 }}>
        expected: <output data-testid="expected">{RECEIVE_TEXT}</output> | received:{' '}
        <output data-testid="received">{received?.text ?? ''}</output> | filename:{' '}
        <output data-testid="received-filename">{received?.filename ?? ''}</output>
      </p>

      <QrStreamReceiver
        decoder={zxingDecoder}
        download={false}
        title="offline receive"
        onComplete={(data, filename) => {
          const bytes = Array.from(data);
          const text = new TextDecoder().decode(data);
          (window as unknown as { __qrReceived?: Received }).__qrReceived = { text, filename, bytes };
          setReceived({ text, filename, bytes });
        }}
      />
    </main>
  );
}

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root');

/**
 * Paint one `k = 1` packet onto a canvas and serve that canvas as the camera.
 * The same frame is repainted so the receiver's frame callback keeps firing.
 */
async function installCanvasCamera(): Promise<void> {
  const payload = new TextEncoder().encode(RECEIVE_TEXT);
  const writer = await createQrStreamWriter(payload, { filename: RECEIVE_FILENAME, preset: 'fast' });
  const { value: packet } = await writer.packets().next();
  if (packet === undefined) throw new Error('the writer produced no packet');

  // Scale 8: 105 modules (v20 + quiet zone) → 840 px, comfortably above the
  // decoder's minimum pixels-per-module.
  const image = matrixToRGBA(packetToMatrix(packet, writer.version), 8);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2d context unavailable');

  const frame = new ImageData(image.data, image.width, image.height);
  context.putImageData(frame, 0, 0);
  setInterval(() => context.putImageData(frame, 0, 0), 100);

  // Captured streams are only guaranteed to produce frames while the canvas is
  // rendered, so park it offscreen rather than hiding it with `display: none`.
  canvas.dataset.testid = 'source-canvas';
  canvas.style.cssText = 'position: fixed; left: -10000px; top: 0;';
  document.body.append(canvas);

  const stream = canvas.captureStream(10);
  navigator.mediaDevices.getUserMedia = () => Promise.resolve(stream);
}

async function bootstrap(root: HTMLElement): Promise<void> {
  const mode = window.location.hash.includes('receive') ? 'receive' : 'camera';
  if (mode === 'receive') await installCanvasCamera();

  createRoot(root).render(mode === 'receive' ? <OfflineReceive /> : <CameraHarness />);
}

void bootstrap(container);
