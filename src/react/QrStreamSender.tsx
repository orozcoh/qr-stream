import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { estimateTransferSeconds, quantizeFps, renderQrStream, type RenderController } from '../browser/render.js';
import type { QrStreamError } from '../core/errors.js';
import { MAX_INPUT_BYTES, PRESETS, type PresetName, type TransferLimits } from '../core/types.js';
import { ErrorText } from './ErrorText.js';
import { describeAcceptTypes, matchesAccept } from './file-accept.js';
import { formatQrString, resolveQrStreamStrings, type QrStreamStrings } from './strings.js';
import { ensureQrStreamStyles } from './styles.js';
import { useQrStreamWriter } from './useQrStreamWriter.js';

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
  /**
   * Core transfer budgets. The file picker pre-checks against the input budget
   * and `maxBytes`; the writer's wire-size check remains final.
   */
  limits?: TransferLimits;
  /** Called when the stream starts or stops, for embedding apps. */
  onRunningChange?(running: boolean): void;
  className?: string;
  /** Copy overrides; every visible label is translatable. */
  strings?: Partial<QrStreamStrings>;
  /** Host translation for writer errors. Defaults to `error.message`. */
  formatError?(error: QrStreamError): string;
}

/** A rejection notice kept as a template so a later translation still applies. */
interface Notice {
  readonly kind: 'fileTypeRejected' | 'fileTooLarge';
  readonly values: Readonly<Record<string, string | number>>;
}

function formatEstimate(seconds: number): string {
  if (seconds < 60) return `~${seconds} s`;
  return `~${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function QrStreamSender({
  title = 'qr-stream',
  accept,
  maxBytes,
  limits,
  onRunningChange,
  className,
  strings,
  formatError,
}: QrStreamSenderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<RenderController | null>(null);
  const runningRef = useRef(false);
  const onRunningChangeRef = useRef(onRunningChange);
  onRunningChangeRef.current = onRunningChange;
  const passphraseId = useId();

  const [data, setData] = useState<Uint8Array | null>(null);
  const [filename, setFilename] = useState('payload');
  const [preset, setPreset] = useState<PresetName>('balanced');
  const [passphrase, setPassphrase] = useState('');
  const [fps, setFps] = useState(PRESETS.balanced.fps);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const text = resolveQrStreamStrings(strings);

  const limit =
    typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.min(maxBytes, MAX_INPUT_BYTES)
      : MAX_INPUT_BYTES;

  const { writer, error, pending } = useQrStreamWriter({
    data,
    filename,
    preset,
    ...(passphrase ? { passphrase } : {}),
    ...(limits ? { limits } : {}),
  });

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    runningRef.current = false;
    setRunning(false);
    onRunningChangeRef.current?.(false);
  }, []);

  const start = useCallback(() => {
    if (!writer || !canvasRef.current) return;
    controllerRef.current?.stop();

    controllerRef.current = renderQrStream({
      writer,
      canvas: canvasRef.current,
      fps,
    });
    controllerRef.current.play();
    runningRef.current = true;
    setRunning(true);
    onRunningChangeRef.current?.(true);
  }, [fps, writer]);

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
      onRunningChangeRef.current?.(false);
      return;
    }

    start();
  }, [writer, start]);

  useEffect(() => {
    controllerRef.current?.setFps(fps);
  }, [fps]);

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;

    if (!matchesAccept(file, accept)) {
      setNotice({ kind: 'fileTypeRejected', values: { name: file.name } });
      setData(null);
      return;
    }
    if (file.size > limit) {
      setNotice({
        kind: 'fileTooLarge',
        values: { kb: Math.round(file.size / 1024), limit: Math.round(limit / 1024) },
      });
      setData(null);
      return;
    }

    setNotice(null);
    setFilename(file.name);
    setData(new Uint8Array(await file.arrayBuffer()));
  };

  const estimate = writer ? formatEstimate(estimateTransferSeconds(writer.k, quantizeFps(fps))) : '';
  const noticeText =
    notice === null
      ? null
      : formatQrString(notice.kind === 'fileTypeRejected' ? text.fileTypeRejected : text.fileTooLarge, notice.values);

  return (
    <div className={className ? `qrs ${className}` : 'qrs'}>
      <h2 className="qrs__title">{title}</h2>

      <div className="qrs__stage" data-empty={!running}>
        <canvas ref={canvasRef} className="qrs__canvas" role="img" aria-label={text.qrCode} />
        {running ? null : <span className="qrs__placeholder">{writer ? text.ready : text.chooseFile}</span>}
      </div>

      {running ? (
        <label className="qrs__field">
          <span className="qrs__label">{formatQrString(text.speed, { fps, estimate })}</span>
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
        {running ? text.stop : pending ? text.preparing : text.start}
      </button>

      {running ? (
        <p className="qrs__meta">{text.stopToChange}</p>
      ) : (
        <div className="qrs__settings">
          <label className="qrs__field">
            <span className="qrs__label">
              {text.file}{' '}
              {accept ? (
                <span className="qrs__hint">
                  {formatQrString(text.accepts, { types: describeAcceptTypes(accept) })}
                </span>
              ) : null}
            </span>
            <input
              className="qrs__input"
              type="file"
              {...(accept ? { accept } : {})}
              onChange={(event) => void pickFile(event.target.files?.[0])}
            />
          </label>

          <label className="qrs__field">
            <span className="qrs__label">{text.density}</span>
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
                  {formatQrString(text.densityOption, { name, version: PRESETS[name].version })}
                </option>
              ))}
            </select>
          </label>

          <div className="qrs__field">
            <label className="qrs__label" htmlFor={passphraseId}>
              {text.passphrase} <span className="qrs__hint">{text.optional}</span>
            </label>
            <input
              id={passphraseId}
              className="qrs__input"
              type="password"
              value={passphrase}
              autoComplete="off"
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder={text.passphraseHint}
            />
          </div>
        </div>
      )}

      <ErrorText error={error} {...(formatError ? { formatError } : {})} />
      {noticeText ? (
        <p className="qrs__error" role="alert">
          {noticeText}
        </p>
      ) : null}
    </div>
  );
}
