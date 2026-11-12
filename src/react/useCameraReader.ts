import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readQrStream,
  type CameraController,
  type CameraDevice,
  type CameraDiagnostics,
} from '../browser/camera';
import type { FrameDecoder } from '../browser/decoder';

export interface UseCameraReaderOptions {
  deviceId?: string;
  onSymbol?(bytes: Uint8Array): void;
  /** Builds the QR decoder. Required — the package ships none. */
  createDecoder(): Promise<FrameDecoder>;
}

export interface UseCameraReaderResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  devices: CameraDevice[];
  activeId: string | null;
  select(id: string): Promise<void>;
  cycle(): Promise<void>;
  /** Reopens the camera and enumerates again, for browsers that list lazily. */
  rescan(): Promise<void>;
  switching: boolean;
  error: string | null;
  ready: boolean;
  /** Everything the browser reports, for diagnosing a short camera list. */
  diagnostics: CameraDiagnostics | null;
  zoom: { min: number; max: number; step: number } | null;
  zoomValue: number;
  setZoom(value: number): Promise<void>;
}

/** Raw DOMException text is terse and leaks internals; say what to do instead. */
function explainCameraFailure(cause: unknown): string {
  if (cause instanceof DOMException) {
    if (cause.name === 'NotAllowedError') return 'Camera permission denied. Allow access, then reopen.';
    if (cause.name === 'NotFoundError') return 'No camera found on this device.';
    if (cause.name === 'NotReadableError') return 'The camera is in use by another app.';
  }
  return 'The camera could not be opened.';
}

export function useCameraReader(options: UseCameraReaderOptions): UseCameraReaderResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<CameraController | null>(null);
  const symbolRef = useRef(options.onSymbol);
  symbolRef.current = options.onSymbol;

  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics | null>(null);
  const [zoom, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoomValue, setZoomValue] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const sync = useCallback((): void => {
    const controller = controllerRef.current;
    if (!controller) return;
    setDevices(controller.devices());
    setActiveId(controller.activeId());
    setDiagnostics(controller.diagnostics());
    const range = controller.zoomRange();
    setZoomRange(range);
    if (range) setZoomValue(range.min);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      const video = videoRef.current;
      if (!video) return;
      try {
        const decode = await options.createDecoder();
        // The modal can unmount while the decoder loads. React detaches the ref
        // before the passive cleanup, so check both the captured element and its
        // document attachment before opening the camera.
        if (cancelled || !video.isConnected) {
          await decode.dispose?.();
          return;
        }
        const controller = await readQrStream({
          video,
          decode,
          ...(options.deviceId ? { deviceId: options.deviceId } : {}),
        });
        if (cancelled) {
          controller.stop();
          return;
        }
        controllerRef.current = controller;
        controller.onSymbol((bytes) => symbolRef.current?.(bytes));
        controller.onError((message) => setError(message));
        sync();
        setReady(true);
      } catch (cause) {
        if (!cancelled) {
          setError(explainCameraFailure(cause));
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      controllerRef.current?.stop();
      controllerRef.current = null;
    };
    // The camera is opened once per mount; `wasmUrl` and `deviceId` are initial
    // configuration, not something to react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSwitch = useCallback(
    async (action: () => Promise<void> | void) => {
      setSwitching(true);
      try {
        await action();
        sync();
      } finally {
        setSwitching(false);
      }
    },
    [sync],
  );

  const select = useCallback(
    (id: string) => runSwitch(() => controllerRef.current?.select(id)),
    [runSwitch],
  );

  const cycle = useCallback(
    () => runSwitch(() => controllerRef.current?.cycle()),
    [runSwitch],
  );

  const rescan = useCallback(
    () => runSwitch(() => controllerRef.current?.rescan()),
    [runSwitch],
  );

  const setZoom = useCallback(
    async (value: number) => {
      setZoomValue(value);
      await controllerRef.current?.setZoom(value);
    },
    [],
  );

  return {
    videoRef,
    devices,
    activeId,
    select,
    cycle,
    rescan,
    switching,
    error,
    ready,
    diagnostics,
    zoom,
    zoomValue,
    setZoom,
  };
}
