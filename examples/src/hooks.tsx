import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import zxingUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { renderQrStream, type RenderController } from '@orozcoh/qr-stream/browser';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';
import { useCameraReader, useQrStreamReader, useQrStreamWriter } from '@orozcoh/qr-stream/react';
import './styles.css';

// Define the factory once: the hook reads it through a ref, but one stable
// function keeps the call site predictable.
const createDecoder = () => createZXingDecoder({ wasmUrl: zxingUrl });

function SenderHooks() {
  const [data, setData] = useState<Uint8Array | null>(null);
  const [filename, setFilename] = useState('payload.json');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<RenderController | null>(null);
  const { writer, error, pending } = useQrStreamWriter({ data, filename, preset: 'balanced' });

  useEffect(() => () => controllerRef.current?.stop(), []);

  const start = (): void => {
    if (!writer || !canvasRef.current) return;
    controllerRef.current?.stop();
    controllerRef.current = renderQrStream({ writer, canvas: canvasRef.current, size: 320 });
    controllerRef.current.play();
  };

  return (
    <section className="row">
      <h2>Sender</h2>
      <label className="field">
        File
        <input
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFilename(file.name);
            void file.arrayBuffer().then((buffer) => setData(new Uint8Array(buffer)));
          }}
        />
      </label>
      <div className="stage">
        <canvas ref={canvasRef} role="img" aria-label="QR stream" />
      </div>
      <div className="actions">
        <button type="button" onClick={start} disabled={!writer}>
          {pending ? 'Preparing…' : 'Start'}
        </button>
        <button type="button" onClick={() => controllerRef.current?.stop()}>
          Stop
        </button>
      </div>
      <p className="status">
        {writer ? `${writer.plainBytes} bytes → ${writer.wireBytes} on the wire · ${writer.k} blocks` : 'Choose a file'}
      </p>
      {error ? <p className="error">{`${error.code}: ${error.message}`}</p> : null}
    </section>
  );
}

function ReceiverHooks() {
  const [enabled, setEnabled] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const reader = useQrStreamReader();
  const camera = useCameraReader({ createDecoder, onSymbol: reader.add, enabled });
  const received = reader.result;

  useEffect(() => {
    if (!received) {
      setDownloadUrl(null);
      return;
    }
    const blob = new Blob([received.data as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [received]);

  const error = camera.error ?? reader.error;

  return (
    <section className="row">
      <h2>Receiver</h2>
      <video ref={camera.videoRef} playsInline muted aria-label="Camera preview" />
      <div className="actions">
        <button type="button" onClick={() => setEnabled(true)} disabled={enabled || camera.starting}>
          Start camera
        </button>
        <button
          type="button"
          onClick={() => {
            setEnabled(false);
            reader.reset();
          }}
          disabled={!enabled}
        >
          Stop
        </button>
      </div>
      <p className="status">
        {reader.progress.solved} / {reader.progress.k} blocks · {reader.solveRate} frames/s
      </p>
      {received ? (
        <p className="status">
          {received.meta.filename} — SHA-256 verified.{' '}
          {downloadUrl ? (
            <a href={downloadUrl} download={received.meta.filename}>
              Save file
            </a>
          ) : null}
        </p>
      ) : null}
      {error ? <p className="error">{`${error.code}: ${error.message}`}</p> : null}
    </section>
  );
}

function App() {
  return (
    <>
      <SenderHooks />
      <ReceiverHooks />
    </>
  );
}

const container = document.querySelector('#root');
if (!container) throw new Error('hooks.html is missing #root');

createRoot(container).render(<App />);
