import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FrameDecoder } from '../browser/decoder.js';
import type { QrStreamError } from '../core/errors.js';
import type { ReaderLimits } from '../core/types.js';
import { DownloadControl } from './DownloadControl.js';
import { ErrorText } from './ErrorText.js';
import { formatQrString, resolveQrStreamStrings, type QrStreamStrings } from './strings.js';
import { ensureQrStreamStyles } from './styles.js';
import { useCameraReader } from './useCameraReader.js';
import { useQrStreamReader } from './useQrStreamReader.js';

ensureQrStreamStyles();

/** Recoveries where reopening the camera is a meaningful next action. */
const CAMERA_RETRY_RECOVERIES: ReadonlySet<QrStreamError['recovery']> = new Set([
  'retry',
  'grant-permission',
  'change-camera',
  'upgrade-browser',
]);

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
  /** Passed through to the reader. */
  limits?: ReaderLimits;
  onComplete?(data: Uint8Array, filename: string): void;
  className?: string;
  /** Copy overrides; every visible label is translatable. */
  strings?: Partial<QrStreamStrings>;
  /** Host translation for camera and reader errors. Defaults to `error.message`. */
  formatError?(error: QrStreamError): string;
}

export function QrStreamReceiver({
  title,
  passphrase,
  decoder,
  cameraControls = 'auto',
  download = true,
  limits,
  onComplete,
  className,
  strings,
  formatError,
}: QrStreamReceiverProps) {
  const { progress, solveRate, result, wrongKey, stale, error, add, retryKey, reset } = useQrStreamReader({
    ...(passphrase ? { passphrase } : {}),
    ...(limits ? { limits } : {}),
  });
  const {
    videoRef,
    devices,
    activeId,
    select,
    cycle,
    rescan,
    start,
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
  const unlockId = useId();

  const text = resolveQrStreamStrings(strings);

  const complete = useCallback((data: Uint8Array, filename: string) => onComplete?.(data, filename), [onComplete]);

  useEffect(() => {
    if (!result) {
      // A reset or a new session clears the delivered marker and releases the
      // previous download URL. `reader.result()` memoizes the verified bytes,
      // so the identity check below is stable for a completed transfer.
      completedRef.current = null;
      setDownloadUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      return;
    }
    if (completedRef.current === result.data) return;
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
  const showCameraPicker = cameraControls === 'always' || (cameraControls === 'auto' && devices.length > 1);
  const showSwitch = cameraControls !== 'hidden' && devices.length > 1;

  return (
    <div className={className ? `qrs ${className}` : 'qrs'}>
      {title ? <h2 className="qrs__title">{title}</h2> : null}

      <div className="qrs__feed">
        <video ref={videoRef} className="qrs__video" playsInline muted aria-label={text.cameraPreview} />
        {cameraError ? <span className="qrs__placeholder">{text.cameraUnavailable}</span> : null}
      </div>

      {cameraError && CAMERA_RETRY_RECOVERIES.has(cameraError.recovery) ? (
        <button type="button" className="qrs__button" onClick={() => void start()}>
          {text.tryAgain}
        </button>
      ) : null}

      {showSwitch ? (
        <button
          type="button"
          className="qrs__button qrs__button--ghost"
          onClick={() => void cycle()}
          disabled={switching}
        >
          {switching ? text.switching : text.switchCamera}
        </button>
      ) : null}

      <div className="qrs__readout">
        <progress
          className="qrs__progress"
          value={progress.solved}
          max={Math.max(1, progress.k)}
          aria-valuetext={formatQrString(text.progressAria, {
            solved: progress.solved,
            k: progress.k,
            percent,
          })}
        />
        <p className="qrs__meta">
          {formatQrString(text.progress, {
            solved: progress.solved,
            k: progress.k,
            percent,
            rate: solveRate,
          })}
        </p>
      </div>

      {showCameraPicker ? (
        <label className="qrs__field">
          <span className="qrs__label">{text.camera}</span>
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
          <span className="qrs__label">{formatQrString(text.zoom, { value: zoomValue.toFixed(1) })}</span>
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
            {text.stale}
          </p>
          <button type="button" className="qrs__button" onClick={() => reset()}>
            {text.switchToNew}
          </button>
        </div>
      ) : null}

      {wrongKey ? (
        <div className="qrs__settings">
          <p className="qrs__error" role="alert">
            {text.wrongKey}
          </p>
          <div className="qrs__field">
            <label className="qrs__label" htmlFor={unlockId}>
              {text.passphraseLabel}
            </label>
            <input
              id={unlockId}
              className="qrs__input"
              type="password"
              value={typedKey}
              autoComplete="off"
              onChange={(event) => setTypedKey(event.target.value)}
              placeholder={text.passphraseInput}
            />
          </div>
          <button type="button" className="qrs__button qrs__button--primary" onClick={() => void retryKey(typedKey)}>
            {text.unlock}
          </button>
        </div>
      ) : null}

      {result ? (
        <div className="qrs__settings">
          <p className="qrs__meta" role="status">
            {formatQrString(text.verified, { filename: result.meta.filename })}
          </p>
          {downloadUrl ? (
            <DownloadControl url={downloadUrl} filename={result.meta.filename} label={text.saveFile} />
          ) : null}
          <button type="button" className="qrs__button" onClick={() => reset()}>
            {text.receiveAnother}
          </button>
        </div>
      ) : null}

      <details className="qrs__details">
        <summary className="qrs__summary">{formatQrString(text.diagnostics, { count: devices.length })}</summary>
        <table className="qrs__table">
          <caption className="qrs__sr-only">{formatQrString(text.diagnostics, { count: devices.length })}</caption>
          <thead>
            <tr>
              <th>{text.tableNumber}</th>
              <th>{text.tableLabel}</th>
              <th>{text.tableFacing}</th>
              <th>{text.tableGroup}</th>
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
            {formatQrString(text.activeCamera, {
              label: diagnostics.active.label || text.unnamed,
              width: diagnostics.active.settings.width ?? 0,
              height: diagnostics.active.settings.height ?? 0,
              fps: Math.round(diagnostics.active.settings.frameRate ?? 0),
              focus: String(diagnostics.active.capabilities.focusMode ?? 'n/a'),
            })}
          </p>
        ) : null}

        <p style={{ marginBottom: 8 }}>{text.diagnosticsHint}</p>
        <button
          type="button"
          className="qrs__button qrs__button--ghost"
          onClick={() => void rescan()}
          disabled={switching}
        >
          {switching ? text.scanning : text.rescan}
        </button>
      </details>

      <ErrorText error={cameraError} {...(formatError ? { formatError } : {})} />
      <ErrorText error={wrongKey ? null : error} {...(formatError ? { formatError } : {})} />
    </div>
  );
}
