import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureQrStreamStyles } from './styles';
import { useCameraReader } from './useCameraReader';
import type { FrameDecoder } from '../browser/decoder';
import { useQrStreamReader } from './useQrStreamReader';

ensureQrStreamStyles();

export interface QrStreamReceiverProps {
  /** Optional heading above the camera feed. */
  title?: string;
  passphrase?: string;
  /**
   * Builds the QR decoder, e.g. `() => createZXingDecoder({ wasmUrl })`.
   * Required: this package ships no decoder, so the one you choose is the only
   * one that ends up in your bundle.
   */
  decoder(): Promise<FrameDecoder>;
  /** `auto` shows the picker only when the device reports more than one camera. */
  cameraControls?: 'auto' | 'hidden' | 'always';
  /** Offer a save link. On by default: a received file you cannot save is a dead end. */
  download?: boolean;
  onComplete?(data: Uint8Array, filename: string): void;
  className?: string;
}

export function QrStreamReceiver({
  title,
  passphrase,
  decoder,
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
    rescan,
    switching,
    error: cameraError,
    diagnostics,
    zoom,
    zoomValue,
    setZoom,
  } = useCameraReader({
    onSymbol: add,
    createDecoder: decoder,
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
      const blob = new Blob([result.data as BlobPart], { type: 'application/octet-stream' });
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
  const showSwitch = cameraControls !== 'hidden' && devices.length > 1;

  return (
    <div className={className ? `qrs ${className}` : 'qrs'}>
      {title ? <h2 className="qrs__title">{title}</h2> : null}

      <div className="qrs__feed">
        <video ref={videoRef} className="qrs__video" playsInline muted />
        {cameraError ? <span className="qrs__placeholder">Camera unavailable</span> : null}
      </div>

      {showSwitch ? (
        <button type="button" className="qrs__button qrs__button--ghost" onClick={() => void cycle()} disabled={switching}>
          {switching ? 'Switching…' : 'Switch camera'}
        </button>
      ) : null}

      <div className="qrs__readout">
        <progress
          className="qrs__progress"
          value={progress.solved}
          max={Math.max(1, progress.k)}
          aria-valuetext={`${progress.solved} of ${progress.k} blocks, ${percent} percent`}
        />
        <p className="qrs__meta">
          {progress.solved} / {progress.k} blocks · {percent}% · {solveRate} frames/s
        </p>
      </div>

      {showCameraPicker ? (
        <label className="qrs__field">
          <span className="qrs__label">Camera</span>
          <select className="qrs__select" value={activeId ?? ''} onChange={(event) => void select(event.target.value)}>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {zoom ? (
        <label className="qrs__field">
          <span className="qrs__label">Zoom — {zoomValue.toFixed(1)}×</span>
          <input
            className="qrs__range"
            type="range"
            min={zoom.min}
            max={zoom.max}
            step={zoom.step}
            value={zoomValue}
            onChange={(event) => void setZoom(Number(event.target.value))}
          />
        </label>
      ) : null}

      {stale ? (
        <div className="qrs__settings">
          <p className="qrs__error" role="alert">
            A different transfer is being sent. This one cannot finish from it.
          </p>
          <button type="button" className="qrs__button" onClick={() => reset()}>
            Switch to the new transfer
          </button>
        </div>
      ) : null}

      {wrongKey ? (
        <div className="qrs__settings">
          <input
            className="qrs__input"
            type="password"
            value={typedKey}
            autoComplete="off"
            aria-label="Passphrase"
            onChange={(event) => setTypedKey(event.target.value)}
            placeholder="passphrase"
          />
          <button type="button" className="qrs__button qrs__button--primary" onClick={() => void retryKey(typedKey)}>
            Unlock
          </button>
        </div>
      ) : null}

      {result ? (
        <div className="qrs__settings">
          <p className="qrs__meta" role="status">
            {result.meta.filename} — SHA-256 verified
          </p>
          {downloadUrl ? (
            <a href={downloadUrl} download={result.meta.filename}>
              <button type="button" className="qrs__button qrs__button--primary">
                Save file
              </button>
            </a>
          ) : null}
          <button type="button" className="qrs__button" onClick={() => reset()}>
            Receive another
          </button>
        </div>
      ) : null}

      <details className="qrs__details">
        <summary className="qrs__summary">Cameras reported by this browser ({devices.length})</summary>
        <table className="qrs__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Label</th>
              <th>Facing</th>
              <th>Group</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device, index) => (
              <tr key={device.deviceId} style={{ opacity: device.deviceId === activeId ? 1 : 0.6 }}>
                <td>{device.deviceId === activeId ? '●' : index + 1}</td>
                <td>{device.label}</td>
                <td>{device.facing}</td>
                <td>{device.groupId.slice(0, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {diagnostics?.active ? (
          <p>
            Active: {diagnostics.active.label || 'unnamed'} ·{' '}
            {diagnostics.active.settings.width}×{diagnostics.active.settings.height} @{' '}
            {Math.round(diagnostics.active.settings.frameRate ?? 0)} fps · focus{' '}
            {String(diagnostics.active.capabilities.focusMode ?? 'n/a')}
          </p>
        ) : null}

        <p style={{ marginBottom: 8 }}>
          Some Android builds only list secondary rear cameras after the stream has been opened
          once. If your phone has more than the browser lists, that is a browser limit.
        </p>
        <button type="button" className="qrs__button qrs__button--ghost" onClick={() => void rescan()} disabled={switching}>
          {switching ? 'Scanning…' : 'Rescan cameras'}
        </button>
      </details>

      {cameraError ? (
        <p className="qrs__error" role="alert">
          {cameraError}
        </p>
      ) : null}
      {error ? (
        <p className="qrs__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
