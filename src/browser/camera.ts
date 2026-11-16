import { CameraError, DecoderError, type QrStreamError } from '../core/errors.js';
import type { FrameDecoder } from './decoder.js';

export interface CameraDevice {
  deviceId: string;
  label: string;
  facing: 'environment' | 'user' | 'unknown';
  /** Cameras sharing a group sit on the same physical module. */
  groupId: string;
}

/** Non-standard track capabilities that Chrome exposes but the DOM types omit. */
export interface CameraCapabilities {
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
  [key: string]: unknown;
}

export interface CameraDiagnostics {
  devices: CameraDevice[];
  active: {
    deviceId: string | null;
    label: string;
    settings: MediaTrackSettings;
    capabilities: CameraCapabilities;
  } | null;
}

export interface CameraController {
  devices(): CameraDevice[];
  activeId(): string | null;
  select(id: string): Promise<void>;
  /** Next rear camera — one tap while already pointing at the screen. */
  cycle(): Promise<void>;
  stop(): void;
  onSymbol(callback: (bytes: Uint8Array) => void): void;
  /** Single typed error channel. No string matching. */
  onError(callback: (error: QrStreamError) => void): void;
  /** What the browser actually reports — the only way to explain a short list. */
  diagnostics(): CameraDiagnostics;
  /** Reopens the current camera and enumerates again. */
  rescan(): Promise<void>;
  zoomRange(): { min: number; max: number; step: number } | null;
  setZoom(value: number): Promise<void>;
  applyConstraints(constraints: MediaTrackConstraints): Promise<void>;
}

export interface ReadOptions {
  video: HTMLVideoElement;
  /**
   * Required. There is deliberately no default: a built-in decoder would put a
   * ~925 KB dependency in this entry point and in every project that imports it.
   */
  decode: FrameDecoder;
  /** Camera to open first. Falls back to environment-facing when absent. */
  deviceId?: string;
  /** Extra constraints merged into every getUserMedia call. */
  videoConstraints?: MediaTrackConstraints;
}

/** Decode at most this wide; more pixels cost time without adding detail. */
const MAX_DECODE_WIDTH = 1280;
const STORAGE_KEY = 'qr-stream:camera';

function inferFacing(label: string): CameraDevice['facing'] {
  const text = label.toLowerCase();
  if (/(back|rear|environment|world)/.test(text)) return 'environment';
  if (/(front|user|face|selfie)/.test(text)) return 'user';
  return 'unknown';
}

function describe(device: MediaDeviceInfo, index: number): CameraDevice {
  const facing = inferFacing(device.label);
  const fallback =
    facing === 'environment'
      ? `Back camera ${index + 1}`
      : facing === 'user'
        ? `Front camera ${index + 1}`
        : `Camera ${index + 1}`;
  return { deviceId: device.deviceId, label: device.label || fallback, facing, groupId: device.groupId };
}

/** Remove the caller's device selection so it cannot conflict with ours. */
function withoutSelection(constraints: MediaTrackConstraints): MediaTrackConstraints {
  const copy = { ...constraints };
  delete copy.deviceId;
  delete copy.facingMode;
  return copy;
}

type CameraFailureCode =
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_IN_USE'
  | 'CAMERA_UNAVAILABLE'
  | 'CAMERA_CONSTRAINTS_FAILED';

const FAILURE_CODES: Record<string, CameraFailureCode> = {
  NotAllowedError: 'CAMERA_PERMISSION_DENIED',
  NotFoundError: 'CAMERA_NOT_FOUND',
  NotReadableError: 'CAMERA_IN_USE',
  OverconstrainedError: 'CAMERA_CONSTRAINTS_FAILED',
};

const FAILURE_MESSAGES: Partial<Record<CameraFailureCode, string>> = {
  CAMERA_PERMISSION_DENIED: 'Camera permission denied. Allow access and try again.',
  CAMERA_NOT_FOUND: 'No camera was found on this device.',
  CAMERA_IN_USE: 'The camera is in use by another app.',
  CAMERA_CONSTRAINTS_FAILED: 'The requested camera constraints could not be satisfied.',
};

/** Map a getUserMedia/setup failure onto the stable camera codes. */
function toCameraError(cause: unknown, unavailableMessage: string): CameraError {
  if (cause instanceof CameraError) return cause;
  const name = cause instanceof DOMException ? cause.name : '';
  const code = FAILURE_CODES[name] ?? 'CAMERA_UNAVAILABLE';
  return new CameraError(code, FAILURE_MESSAGES[code] ?? unavailableMessage, { cause });
}

/**
 * Read a QR stream from a camera.
 *
 * Requests the environment-facing camera first so the OS grants permission —
 * until then `enumerateDevices()` returns blank labels and there is nothing
 * useful to show the user. Switching then stops every track before opening the
 * replacement, because iOS refuses a second concurrent camera stream.
 */
export async function readQrStream(options: ReadOptions): Promise<CameraController> {
  const { video } = options;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new CameraError('CAMERA_UNAVAILABLE', '2d context unavailable for decoding');

  let stream: MediaStream | null = null;
  let tracks: CameraDevice[] = [];
  let active: string | null = null;
  let stopped = false;
  let disposed = false;
  let openGeneration = 0;
  let frameHandle = 0;
  let timerHandle: ReturnType<typeof setTimeout> | 0 = 0;
  let decoding = false;
  let symbolHandler: ((bytes: Uint8Array) => void) | null = null;
  let errorHandler: ((error: QrStreamError) => void) | null = null;
  let consecutiveFailures = 0;
  let reportedDecodeFailure = false;

  const report = (error: QrStreamError): void => errorHandler?.(error);

  const baseConstraints = (): MediaTrackConstraints => ({ ...(options.videoConstraints ?? {}) });

  const enumerate = async (): Promise<CameraDevice[]> => {
    const all = await navigator.mediaDevices.enumerateDevices();
    tracks = all.filter((device) => device.kind === 'videoinput').map((device, index) => describe(device, index));
    return tracks;
  };

  const open = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    openGeneration += 1;
    const myGeneration = openGeneration;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    active = null;
    const next = await navigator.mediaDevices.getUserMedia(constraints);
    // stop() or a newer open() may have won while getUserMedia was pending.
    // Install nothing and release the tracks we just acquired.
    if (stopped || myGeneration !== openGeneration) {
      for (const track of next.getTracks()) track.stop();
      throw new DOMException('Camera closed', 'AbortError');
    }
    stream = next;
    video.srcObject = next;
    await video.play().catch(() => undefined);

    const settings = next.getVideoTracks()[0]?.getSettings();
    active = settings?.deviceId ?? active;
    if (active) {
      try {
        localStorage.setItem(STORAGE_KEY, active);
      } catch {
        // Private mode: remembering the camera is a convenience, not a requirement.
      }
    }
    await enumerate();
    return next;
  };

  const openDevice = async (id: string): Promise<void> => {
    await open({ video: { ...withoutSelection(baseConstraints()), deviceId: { exact: id } } });
  };

  const openPreferred = async (): Promise<void> => {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(STORAGE_KEY);
    } catch {
      remembered = null;
    }

    if (remembered) {
      try {
        await openDevice(remembered);
        return;
      } catch {
        // The saved camera is gone; fall through to the default.
      }
    }

    const base = baseConstraints();
    try {
      await open({
        video: { ...withoutSelection(base), facingMode: base.facingMode ?? { ideal: 'environment' } },
      });
    } catch {
      await open({ video: base });
    }
  };

  const decodeFrame = async (): Promise<void> => {
    if (stopped || decoding) return;
    decoding = true;
    try {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width > 0 && height > 0) {
        const scale = Math.min(1, MAX_DECODE_WIDTH / Math.max(width, height));
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }
        context.drawImage(video, 0, 0, targetWidth, targetHeight);
        const image = context.getImageData(0, 0, targetWidth, targetHeight);
        const bytes = await options.decode.decode(image);
        if (bytes !== null) symbolHandler?.(bytes);
      }
      consecutiveFailures = 0;
    } catch (failure) {
      consecutiveFailures += 1;
      // One bad frame is normal. Sixty in a row means the decoder itself is
      // failing — almost always the WASM never loaded, which is silent and
      // looks identical to "the camera cannot see the code".
      if (consecutiveFailures === 60 && !reportedDecodeFailure) {
        reportedDecodeFailure = true;
        report(
          failure instanceof DecoderError
            ? failure
            : new DecoderError('Decoding is not working. Check the decoder you passed in.', { cause: failure }),
        );
      }
    } finally {
      decoding = false;
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if ('requestVideoFrameCallback' in video) {
      frameHandle = video.requestVideoFrameCallback(() => {
        void decodeFrame().then(schedule);
      });
    } else {
      timerHandle = setTimeout(() => {
        void decodeFrame().then(schedule);
      }, 80);
    }
  };

  const handleDeviceChange = (): void => {
    void enumerate().catch((cause: unknown) => {
      report(toCameraError(cause, 'The camera list could not be refreshed.'));
    });
  };

  const select = async (id: string): Promise<void> => {
    try {
      await openDevice(id);
    } catch (cause) {
      if (stopped) return;
      const error = toCameraError(cause, 'That camera could not be opened.');
      report(error);
      throw error;
    }
  };

  try {
    await openPreferred();
    if (options.deviceId) await select(options.deviceId);
  } catch (error) {
    // getUserMedia may have resolved before a later setup step threw. Release
    // anything acquired so an unmount or a rejected setup cannot leave the
    // camera live with no controller to stop it.
    const currentStream = stream as MediaStream | null;
    for (const track of currentStream?.getTracks() ?? []) track.stop();
    stream = null;
    if (video) video.srcObject = null;
    if (!disposed) {
      disposed = true;
      try {
        await options.decode.dispose?.();
      } catch {
        // A decoder teardown failure must not mask the original error.
      }
    }
    throw toCameraError(error, 'The camera could not be opened.');
  }

  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

  schedule();

  const shutdown = (): void => {
    stopped = true;
    openGeneration += 1;
    cancelAnimationFrame(frameHandle);
    if (timerHandle) clearTimeout(timerHandle);
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    active = null;
    video.srcObject = null;
    navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    if (!disposed) {
      disposed = true;
      try {
        options.decode.dispose?.();
      } catch {
        // A decoder teardown failure must not keep the camera alive.
      }
    }
  };

  return {
    devices: () => tracks,
    activeId: () => active,

    select,

    async cycle(): Promise<void> {
      const rear = tracks.filter((device) => device.facing !== 'user');
      const pool = rear.length > 1 ? rear : tracks;
      if (pool.length < 2) return;
      const index = pool.findIndex((device) => device.deviceId === active);
      const next = pool[(index + 1) % pool.length] as CameraDevice;
      await select(next.deviceId);
    },

    diagnostics(): CameraDiagnostics {
      const track = stream?.getVideoTracks()[0] ?? null;
      if (!track) return { devices: tracks, active: null };
      return {
        devices: tracks,
        active: {
          deviceId: active,
          label: track.label,
          settings: track.getSettings(),
          capabilities: track.getCapabilities() as CameraCapabilities,
        },
      };
    },

    async rescan(): Promise<void> {
      // Some Android builds only reveal secondary rear cameras once a stream
      // has actually been opened and enumerated again.
      try {
        if (active) await openDevice(active);
        else await openPreferred();
      } catch (cause) {
        if (stopped) return;
        const error = toCameraError(cause, 'The camera could not be reopened.');
        report(error);
        shutdown();
        throw error;
      }
    },

    zoomRange() {
      const track = stream?.getVideoTracks()[0];
      const zoom = (track?.getCapabilities() as CameraCapabilities | undefined)?.zoom;
      if (!zoom) return null;
      return { min: zoom.min, max: zoom.max, step: zoom.step ?? 0.1 };
    },

    async setZoom(value: number): Promise<void> {
      const track = stream?.getVideoTracks()[0];
      if (!track) {
        const error = new CameraError('CAMERA_UNAVAILABLE', 'There is no camera to zoom.');
        report(error);
        throw error;
      }
      try {
        // `zoom` is a Chrome extension, absent from the DOM constraint types.
        await track.applyConstraints({ advanced: [{ zoom: value } as unknown as MediaTrackConstraintSet] });
      } catch (cause) {
        const error = new CameraError('CAMERA_CONSTRAINTS_FAILED', 'This camera does not accept a zoom setting.', {
          cause,
        });
        report(error);
        throw error;
      }
    },

    async applyConstraints(constraints: MediaTrackConstraints): Promise<void> {
      const track = stream?.getVideoTracks()[0];
      if (!track) {
        const error = new CameraError('CAMERA_UNAVAILABLE', 'There is no camera to configure.');
        report(error);
        throw error;
      }
      try {
        await track.applyConstraints(constraints);
      } catch (cause) {
        const error = new CameraError('CAMERA_CONSTRAINTS_FAILED', 'The camera rejected the requested constraints.', {
          cause,
        });
        report(error);
        throw error;
      }
    },

    stop(): void {
      shutdown();
    },

    onSymbol(callback: (bytes: Uint8Array) => void): void {
      symbolHandler = callback;
    },

    onError(callback: (error: QrStreamError) => void): void {
      errorHandler = callback;
    },
  };
}
