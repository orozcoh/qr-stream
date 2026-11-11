import { useCallback, useEffect, useRef, useState } from 'react';
import { readQrStream, type CameraController, type CameraDevice } from '../browser/camera';

export interface UseCameraReaderOptions {
  deviceId?: string;
  onSymbol?(bytes: Uint8Array): void;
  wasmUrl?: string;
}

export interface UseCameraReaderResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  devices: CameraDevice[];
  activeId: string | null;
  select(id: string): Promise<void>;
  cycle(): Promise<void>;
  switching: boolean;
  error: string | null;
  ready: boolean;
}

export function useCameraReader(options: UseCameraReaderOptions = {}): UseCameraReaderResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<CameraController | null>(null);
  const symbolRef = useRef(options.onSymbol);
  symbolRef.current = options.onSymbol;

  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      if (!videoRef.current) return;
      try {
        const controller = await readQrStream({
          video: videoRef.current,
          ...(options.wasmUrl ? { wasmUrl: options.wasmUrl } : {}),
          ...(options.deviceId ? { deviceId: options.deviceId } : {}),
        });
        if (cancelled) {
          controller.stop();
          return;
        }
        controllerRef.current = controller;
        controller.onSymbol((bytes) => symbolRef.current?.(bytes));
        controller.onError((message) => setError(message));
        setDevices(controller.devices());
        setActiveId(controller.activeId());
        setReady(true);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Camera failed to start.');
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      controllerRef.current?.stop();
      controllerRef.current = null;
    };
    // The camera is opened once per mount; `wasmUrl` is static configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback(async (id: string) => {
    setSwitching(true);
    try {
      await controllerRef.current?.select(id);
      const controller = controllerRef.current;
      setDevices(controller?.devices() ?? []);
      setActiveId(controller?.activeId() ?? null);
    } finally {
      setSwitching(false);
    }
  }, []);

  const cycle = useCallback(async () => {
    setSwitching(true);
    try {
      await controllerRef.current?.cycle();
      const controller = controllerRef.current;
      setDevices(controller?.devices() ?? []);
      setActiveId(controller?.activeId() ?? null);
    } finally {
      setSwitching(false);
    }
  }, []);

  return { videoRef, devices, activeId, select, cycle, switching, error, ready };
}
