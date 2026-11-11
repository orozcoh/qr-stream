import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_INPUT_BYTES, PRESETS, type PresetName } from '../core/types';
import { renderQrStream, type RenderController } from '../browser/render';
import { useQrStreamWriter } from './useQrStreamWriter';

export interface QrStreamSenderProps {
  /** Called when the stream starts or stops, for embedding apps. */
  onRunningChange?(running: boolean): void;
  className?: string;
}

export function QrStreamSender({ onRunningChange, className }: QrStreamSenderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<RenderController | null>(null);

  const [data, setData] = useState<Uint8Array | null>(null);
  const [filename, setFilename] = useState('payload.json');
  const [preset, setPreset] = useState<PresetName>('balanced');
  const [passphrase, setPassphrase] = useState('');
  const [fps, setFps] = useState(PRESETS.balanced.fps);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { writer, error } = useQrStreamWriter({
    data,
    filename,
    preset,
    ...(passphrase ? { passphrase } : {}),
  });

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    setRunning(false);
    onRunningChange?.(false);
  }, [onRunningChange]);

  useEffect(() => stop, [stop]);

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
    setRunning(true);
    onRunningChange?.(true);
  }, [fps, onRunningChange, preset, writer]);

  useEffect(() => {
    controllerRef.current?.setFps(fps);
  }, [fps]);

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      setNotice(`That file is ${Math.round(file.size / 1024)} KB. The limit is 250 KB.`);
      setData(null);
      return;
    }
    setNotice(null);
    setFilename(file.name);
    setData(new Uint8Array(await file.arrayBuffer()));
  };

  return (
    <section className={className} style={{ display: 'grid', gap: 16 }}>
      <label>
        JSON file
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => void pickFile(event.target.files?.[0])}
        />
      </label>

      <label>
        Density
        <select
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

      <label>
        Passphrase (optional)
        <input
          type="password"
          value={passphrase}
          autoComplete="off"
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="say it aloud, type it on both devices"
        />
      </label>

      <label>
        Speed: {fps} fps {writer ? `· ${writer.k} blocks` : ''}
        <input
          type="range"
          min={1}
          max={30}
          value={fps}
          onChange={(event) => setFps(Number(event.target.value))}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={running ? stop : start} disabled={writer === null}>
          {running ? 'Stop' : 'Start stream'}
        </button>
        <button
          type="button"
          onClick={() => void canvasRef.current?.requestFullscreen?.()}
          disabled={!running}
        >
          Fullscreen
        </button>
      </div>

      {error ? <p role="alert">{error.message}</p> : null}
      {notice ? <p role="alert">{notice}</p> : null}

      <canvas
        ref={canvasRef}
        style={{ width: '100%', maxWidth: 640, imageRendering: 'pixelated', background: '#fff' }}
      />

      <p style={{ fontSize: 13, opacity: 0.75 }}>
        Turn screen brightness to maximum and hold the phone about 25 cm away.
      </p>
    </section>
  );
}
