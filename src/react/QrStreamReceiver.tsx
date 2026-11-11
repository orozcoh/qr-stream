import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCameraReader } from './useCameraReader';
import { useQrStreamReader } from './useQrStreamReader';

export interface QrStreamReceiverProps {
  passphrase?: string;
  /** Location of zxing_reader.wasm. Required offline: the default is a CDN. */
  wasmUrl?: string;
  /** `auto` shows the picker only when the device reports more than one camera. */
  cameraControls?: 'auto' | 'hidden' | 'always';
  /** Offer a save link. On by default: a received file you cannot save is a dead end. */
  download?: boolean;
  onComplete?(data: Uint8Array, filename: string): void;
  className?: string;
}

export function QrStreamReceiver({
  passphrase,
  wasmUrl,
  cameraControls = 'auto',
  download = true,
  onComplete,
  className,
}: QrStreamReceiverProps) {
  const { progress, solveRate, result, wrongKey, stale, error, add, retryKey, reset } = useQrStreamReader({
    ...(passphrase ? { passphrase } : {}),
  });
  const {
    videoRef,
    devices,
    activeId,
    select,
    cycle,
    switching,
    error: cameraError,
  } = useCameraReader({
    onSymbol: add,
    ...(wasmUrl ? { wasmUrl } : {}),
  });

  const [typedKey, setTypedKey] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const completedRef = useRef<Uint8Array | null>(null);

  const complete = useCallback(
    (data: Uint8Array, filename: string) => onComplete?.(data, filename),
    [onComplete],
  );

  useEffect(() => {
    if (!result || completedRef.current === result.data) return;
    completedRef.current = result.data;

    if (download) {
      const blob = new Blob([result.data as BlobPart], { type: 'application/json' });
      setDownloadUrl(URL.createObjectURL(blob));
    }
    complete(result.data, result.meta.filename);
  }, [result, download, complete]);

  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );

  const percent = progress.k > 0 ? Math.round((progress.solved / progress.k) * 100) : 0;
  const showCameraPicker =
    cameraControls === 'always' || (cameraControls === 'auto' && devices.length > 1);
  const showOverlaySwitch = cameraControls !== 'hidden' && devices.length > 1;

  return (
    <section className={className} style={{ display: 'grid', gap: 16 }}>
      <div style={{ position: 'relative' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', maxWidth: 640, aspectRatio: '4 / 3', background: '#000' }}
        />
        {showOverlaySwitch ? (
          <button
            type="button"
            onClick={() => void cycle()}
            disabled={switching}
            style={{ position: 'absolute', right: 8, bottom: 8 }}
          >
            {switching ? 'Switching…' : 'Switch camera'}
          </button>
        ) : null}
      </div>

      {showCameraPicker ? (
        <label>
          Camera
          <select value={activeId ?? ''} onChange={(event) => void select(event.target.value)}>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div>
        <progress value={progress.solved} max={Math.max(1, progress.k)} style={{ width: '100%' }} />
        <p style={{ margin: '4px 0', fontSize: 13 }}>
          {progress.solved}/{progress.k} blocks · {percent}% · catching {solveRate} frames/s
        </p>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
          If that number is well below the sender&apos;s fps, ask them to slow down.
        </p>
      </div>

      {stale ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p role="alert">
            A different transfer is being sent. This one cannot finish from it.
          </p>
          <button type="button" onClick={() => reset()}>
            Switch to the new transfer
          </button>
        </div>
      ) : null}

      {wrongKey ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <input
            type="password"
            value={typedKey}
            autoComplete="off"
            onChange={(event) => setTypedKey(event.target.value)}
            placeholder="passphrase"
          />
          <button type="button" onClick={() => void retryKey(typedKey)}>
            Unlock
          </button>
        </div>
      ) : null}

      {result ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p role="status" style={{ margin: 0 }}>
            Received {result.meta.filename} — SHA-256 verified.
          </p>
          {downloadUrl ? (
            <a href={downloadUrl} download={result.meta.filename}>
              <button type="button">Save file</button>
            </a>
          ) : null}
          <button type="button" onClick={() => reset()}>
            Receive another
          </button>
        </div>
      ) : null}

      {cameraError ? <p role="alert">{cameraError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
