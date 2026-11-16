import { useCallback, useEffect, useRef, useState } from 'react';
import { readQrStream, type CameraController, type CameraDevice, type CameraDiagnostics } from '../browser/camera.js';
import type { FrameDecoder } from '../browser/decoder.js';
import { CameraError, DecoderError, isQrStreamError, type QrStreamError } from '../core/errors.js';

/**
 * The video element handle this hook owns.
 *
 * Declared as a plain mutable-current object so it is structurally assignable
 * to both React 18's `RefObject<HTMLVideoElement>` and React 19's
 * `RefObject<HTMLVideoElement | null>` without a cast at the call site.
 */
export interface QrVideoRef {
  current: HTMLVideoElement | null;
}

export interface UseCameraReaderOptions {
  /** Camera to open first. Initial configuration: changing it later does not reopen. */
  deviceId?: string;
  /** Extra constraints merged into every getUserMedia call. Initial configuration. */
  videoConstraints?: MediaTrackConstraints;
  onSymbol?(bytes: Uint8Array): void;
  /** Builds the QR decoder. Required — the package ships none. */
  createDecoder(): Promise<FrameDecoder>;
  /**
   * Open the camera automatically, and close it again when this turns false.
   * Default `true`. Manual `start()` still works while `enabled` is false, for
   * a host that drives the lifecycle itself.
   */
  enabled?: boolean;
  /** Called once for every camera or decoder failure the hook records. */
  onError?(error: QrStreamError): void;
}

export interface UseCameraReaderResult {
  videoRef: QrVideoRef;
  devices: CameraDevice[];
  activeId: string | null;
  select(id: string): Promise<void>;
  cycle(): Promise<void>;
  /** Reopens the camera and enumerates again, for browsers that list lazily. */
  rescan(): Promise<void>;
  /** Opens the camera now. Safe to call when it is already starting or open. */
  start(): Promise<void>;
  /** Releases the camera, disposes the decoder, and keeps the last device list. */
  stop(): void;
  starting: boolean;
  switching: boolean;
  error: QrStreamError | null;
  ready: boolean;
  /** Everything the browser reports, for diagnosing a short camera list. */
  diagnostics: CameraDiagnostics | null;
  zoom: { min: number; max: number; step: number } | null;
  zoomValue: number;
  setZoom(value: number): Promise<void>;
}

/** Wrap a non-library failure in the code the UI can branch on. */
function asCameraError(cause: unknown, message: string): QrStreamError {
  return isQrStreamError(cause) ? cause : new CameraError('CAMERA_UNAVAILABLE', message, { cause });
}

export function useCameraReader(options: UseCameraReaderOptions): UseCameraReaderResult {
  const { enabled = true } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<CameraController | null>(null);
  const generationRef = useRef(0);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  /** The last failure handed to the host, so a report and its rejection count once. */
  const reportedRef = useRef<QrStreamError | null>(null);

  // Options are read through refs: a new inline callback or options object on
  // every render must not tear down a live camera.
  const createDecoderRef = useRef(options.createDecoder);
  createDecoderRef.current = options.createDecoder;
  const deviceIdRef = useRef(options.deviceId);
  deviceIdRef.current = options.deviceId;
  const videoConstraintsRef = useRef(options.videoConstraints);
  videoConstraintsRef.current = options.videoConstraints;
  const symbolRef = useRef(options.onSymbol);
  symbolRef.current = options.onSymbol;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics | null>(null);
  const [zoom, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoomValue, setZoomValue] = useState(0);
  const [starting, setStarting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<QrStreamError | null>(null);
  const [ready, setReady] = useState(false);

  const fail = useCallback((failure: QrStreamError): void => {
    // The controller reports an awaited mutation failure and rejects with the
    // same error object. Recording it keeps the host callback to one per
    // failure instead of one per notification path.
    if (reportedRef.current === failure) return;
    reportedRef.current = failure;
    if (!mountedRef.current) return;
    setError(failure);
    onErrorRef.current?.(failure);
  }, []);

  const clearError = useCallback((): void => {
    reportedRef.current = null;
    if (mountedRef.current) setError(null);
  }, []);

  const sync = useCallback((): void => {
    const controller = controllerRef.current;
    if (!controller || !mountedRef.current) return;
    setDevices(controller.devices());
    setActiveId(controller.activeId());
    setDiagnostics(controller.diagnostics());
    const range = controller.zoomRange();
    setZoomRange(range);
    setZoomValue(range ? range.min : 0);
  }, []);

  const stop = useCallback((): void => {
    // Invalidate any decoder or camera open that is still in flight.
    generationRef.current += 1;
    startingRef.current = false;
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.stop();

    if (!mountedRef.current) return;
    setReady(false);
    setStarting(false);
    setSwitching(false);
    // Keep `devices`: restarting is faster with the last list, and the labels
    // do not change while the camera is closed.
    setActiveId(null);
    setDiagnostics(null);
    setZoomRange(null);
    setZoomValue(0);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (controllerRef.current !== null || startingRef.current) return;
    const video = videoRef.current;
    if (video === null) return;

    startingRef.current = true;
    const generation = (generationRef.current += 1);
    if (mountedRef.current) setStarting(true);

    let phase: 'decoder' | 'camera' = 'decoder';
    try {
      const decode = await createDecoderRef.current();
      // The modal can unmount, or the host can call stop(), while the decoder
      // loads. React detaches the ref before the passive cleanup, so check both
      // the generation and the element's document attachment.
      if (generation !== generationRef.current || !video.isConnected) {
        try {
          await decode.dispose?.();
        } catch {
          // The camera is already closed; a teardown failure must not surface
          // as a camera error the host never caused.
        }
        return;
      }

      phase = 'camera';
      const controller = await readQrStream({
        video,
        decode,
        ...(deviceIdRef.current === undefined ? {} : { deviceId: deviceIdRef.current }),
        ...(videoConstraintsRef.current === undefined ? {} : { videoConstraints: videoConstraintsRef.current }),
      });

      if (generation !== generationRef.current || !video.isConnected) {
        controller.stop();
        return;
      }

      controllerRef.current = controller;
      controller.onSymbol((bytes) => symbolRef.current?.(bytes));
      controller.onError((failure) => {
        // A dead decoder cannot recover by itself. Release the controller so
        // the host's retry can open a fresh camera and decoder instead of
        // reusing a session that will never decode another frame.
        if (failure.code === 'DECODER_FAILED') stop();
        fail(failure);
      });
      sync();
      clearError();
      if (mountedRef.current) setReady(true);
    } catch (cause) {
      // A stop() or unmount won the race; the failure is ours, not the host's.
      if (generation !== generationRef.current || !mountedRef.current) return;
      fail(
        isQrStreamError(cause)
          ? cause
          : phase === 'decoder'
            ? new DecoderError('The QR decoder could not be created.', { cause })
            : new CameraError('CAMERA_UNAVAILABLE', 'The camera could not be opened.', { cause }),
      );
    } finally {
      // An older start must not clear the flag for a newer one.
      if (generation === generationRef.current) {
        startingRef.current = false;
        if (mountedRef.current) setStarting(false);
      }
    }
  }, [clearError, fail, stop, sync]);

  // Registered before the auto-open effect so a StrictMode remount marks the
  // hook mounted again before `start()` reads it.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    void start();
    // `createDecoder` and the camera options are initial configuration; only
    // `enabled` decides the automatic lifecycle.
  }, [enabled, start, stop]);

  const runSwitch = useCallback(
    async (action: () => Promise<void> | void, recover: boolean): Promise<void> => {
      if (mountedRef.current) setSwitching(true);
      try {
        await action();
      } catch (cause) {
        fail(asCameraError(cause, 'That camera could not be opened.'));
        // A rejected reopen leaves the controller with no live track, so the
        // hook must forget it; otherwise start() would see a controller and
        // refuse to open a fresh camera, dead-ending the retry.
        if (recover) stop();
      } finally {
        sync();
        if (mountedRef.current) setSwitching(false);
      }
    },
    [fail, stop, sync],
  );

  const select = useCallback(
    (id: string): Promise<void> => {
      const controller = controllerRef.current;
      // `open()` stops the old tracks before requesting the new camera, so a
      // rejected select leaves no live stream to keep.
      return controller ? runSwitch(() => controller.select(id), true) : Promise.resolve();
    },
    [runSwitch],
  );

  const cycle = useCallback((): Promise<void> => {
    const controller = controllerRef.current;
    return controller ? runSwitch(() => controller.cycle(), true) : Promise.resolve();
  }, [runSwitch]);

  const rescan = useCallback((): Promise<void> => {
    const controller = controllerRef.current;
    // The controller shuts itself down on a failed rescan; drop the dead
    // reference here so the retry action can start() again.
    return controller ? runSwitch(() => controller.rescan(), true) : Promise.resolve();
  }, [runSwitch]);

  const setZoom = useCallback(
    async (value: number): Promise<void> => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (mountedRef.current) setZoomValue(value);
      try {
        await controller.setZoom(value);
      } catch (cause) {
        fail(asCameraError(cause, 'This camera does not accept a zoom setting.'));
      }
    },
    [fail],
  );

  return {
    videoRef,
    devices,
    activeId,
    select,
    cycle,
    rescan,
    start,
    stop,
    starting,
    switching,
    error,
    ready,
    diagnostics,
    zoom,
    zoomValue,
    setZoom,
  };
}
