import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_INPUT_BYTES, PRESETS, type PresetName } from '../core/types';
import {
  estimateTransferSeconds,
  quantizeFps,
  renderQrStream,
  type RenderController,
} from '../browser/render';
import { describeAccept, matchesAccept } from './file-accept';
import { ensureQrStreamStyles } from './styles';
import { useQrStreamWriter } from './useQrStreamWriter';

ensureQrStreamStyles();

export interface QrStreamSenderProps {
  /** Shown above the code. Default `"qr-stream"`. */
  title?: string;
  /**
   * Restrict the file picker, using the HTML `accept` attribute's syntax:
   * `.json`, `.json,.csv`, `application/json`, `image/*`. Omitted accepts any file.
   */
  accept?: string;
  /** Tighter size limit than the library's, in bytes. */
  maxBytes?: number;
  /** Called when the stream starts or stops, for embedding apps. */
  onRunningChange?(running: boolean): void;
  className?: string;
}

function formatEstimate(seconds: number): string {
  if (seconds < 60) return `~${seconds} s`;
  return `~${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function QrStreamSender({
  title = 'qr-stream',
  accept,
  maxBytes,
  onRunningChange,
  className,
}: QrStreamSenderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<RenderController | null>(null);
  const runningRef = useRef(false);

  const [data, setData] = useState<Uint8Array | null>(null);
  const [filename, setFilename] = useState('payload');
  const [preset, setPreset] = useState<PresetName>('balanced');
  const [passphrase, setPassphrase] = useState('');
  const [fps, setFps] = useState(PRESETS.balanced.fps);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const limit =
    typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.min(maxBytes, MAX_INPUT_BYTES)
      : MAX_INPUT_BYTES;

  const { writer, error } = useQrStreamWriter({
    data,
    filename,
    preset,
    ...(passphrase ? { passphrase } : {}),
  });

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    runningRef.current = false;
    setRunning(false);
    onRunningChange?.(false);
  }, [onRunningChange]);

  const start = useCallback(() => {
    if (!writer || !canvasRef.current) return;
    controllerRef.current?.stop();

    controllerRef.current = renderQrStream({
      packets: writer.packets(),
      canvas: canvasRef.current,
      fps,
      version: PRESETS[preset].version,
    });
    controllerRef.current.play();
    runningRef.current = true;
    setRunning(true);
    onRunningChange?.(true);
  }, [fps, onRunningChange, preset, writer]);

  useEffect(() => stop, [stop]);

  // A new writer means new blockSize, new K, or a different encryption state.
  // Continuing to paint the old one would keep sending cleartext after a
  // passphrase was typed, so a settings change restarts the stream.
  useEffect(() => {
    if (!runningRef.current) return;

    // The rebuilt writer is not ready yet. Stop the old stream now; the effect
    // runs again when the new writer resolves.
    if (writer === null) {
      controllerRef.current?.stop();
      controllerRef.current = null;
      runningRef.current = false;
      setRunning(false);
      onRunningChange?.(false);
      return;
    }

    start();
  }, [writer, start, onRunningChange]);

  useEffect(() => {
    controllerRef.current?.setFps(fps);
  }, [fps]);

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;

    if (!matchesAccept(file, accept)) {
      setNotice(`${file.name} is not an accepted file type here.`);
      setData(null);
      return;
    }
    if (file.size > limit) {
      setNotice(`That file is ${Math.round(file.size / 1024)} KB. The limit is ${Math.round(limit / 1024)} KB.`);
      setData(null);
      return;
    }

    setNotice(null);
    setFilename(file.name);
    setData(new Uint8Array(await file.arrayBuffer()));
  };

  const estimate = writer ? formatEstimate(estimateTransferSeconds(writer.k, quantizeFps(fps))) : '';

  return (
    <div className={className ? `qrs ${className}` : 'qrs'}>
      <h2 className="qrs__title">{title}</h2>

      <div className="qrs__stage" data-empty={!running}>
        <canvas ref={canvasRef} className="qrs__canvas" aria-label="QR stream" />
        {running ? null : (
          <span className="qrs__placeholder">
            {writer ? 'Ready — press start' : 'Choose a file to begin'}
          </span>
        )}
      </div>

      {running ? (
        <label className="qrs__field">
          <span className="qrs__label">
            Speed — {fps} fps · {estimate} to receive
          </span>
          <input
            className="qrs__range"
            type="range"
            min={1}
            max={30}
            value={fps}
            onChange={(event) => setFps(Number(event.target.value))}
          />
        </label>
      ) : null}

      <button
        type="button"
        className="qrs__button qrs__button--primary"
        onClick={running ? stop : start}
        disabled={writer === null}
      >
        {running ? 'Stop stream' : 'Start stream'}
      </button>

      {running ? (
        <p className="qrs__meta">Stop the stream to change the file, density, or passphrase.</p>
      ) : (
      <div className="qrs__settings">
        <label className="qrs__field">
          <span className="qrs__label">
            File {accept ? <span className="qrs__hint">— {describeAccept(accept)}</span> : null}
          </span>
          <input
            className="qrs__input"
            type="file"
            {...(accept ? { accept } : {})}
            onChange={(event) => void pickFile(event.target.files?.[0])}
          />
        </label>

        <label className="qrs__field">
          <span className="qrs__label">Density</span>
          <select
            className="qrs__select"
            value={preset}
            onChange={(event) => {
              const next = event.target.value as PresetName;
              setPreset(next);
              setFps(PRESETS[next].fps);
            }}
          >
            {(Object.keys(PRESETS) as PresetName[]).map((name) => (
              <option key={name} value={name}>
                {name} — v{PRESETS[name].version}
              </option>
            ))}
          </select>
        </label>

        <label className="qrs__field">
          <span className="qrs__label">
            Passphrase <span className="qrs__hint">— optional</span>
          </span>
          <input
            className="qrs__input"
            type="password"
            value={passphrase}
            autoComplete="off"
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="say it aloud, type it on both devices"
          />
        </label>
      </div>
      )}

      {error ? (
        <p className="qrs__error" role="alert">
          {error.message}
        </p>
      ) : null}
      {notice ? (
        <p className="qrs__error" role="alert">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
