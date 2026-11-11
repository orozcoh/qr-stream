import type { FrameDecoder } from './decoder';

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
  torch?: boolean;
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
  onError(callback: (error: string) => void): void;
  /** What the browser actually reports — the only way to explain a short list. */
  diagnostics(): CameraDiagnostics;
  /** Reopens the current camera and enumerates again. */
  rescan(): Promise<void>;
  zoomRange(): { min: number; max: number; step: number } | null;
  setZoom(value: number): Promise<void>;
}

export interface ReadOptions {
  video: HTMLVideoElement;
  /**
   * Required. There is deliberately no default: a built-in decoder would put a
   * ~925 KB dependency in this entry point and in every project that imports it.
   */
  decode: FrameDecoder;
  /** Camera to open first. Falls back to environment-facing when absent or gone. */
  deviceId?: string;
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
  if (context === null) throw new Error('2d context unavailable for decoding');

  let stream: MediaStream | null = null;
  let tracks: CameraDevice[] = [];
  let active: string | null = null;
  let stopped = false;
  let frameHandle = 0;
  let timerHandle: ReturnType<typeof setTimeout> | 0 = 0;
  let decoding = false;
  let symbolHandler: ((bytes: Uint8Array) => void) | null = null;
  let errorHandler: ((error: string) => void) | null = null;
  let consecutiveFailures = 0;
  let reportedDecodeFailure = false;

  const report = (message: string): void => errorHandler?.(message);

  const enumerate = async (): Promise<CameraDevice[]> => {
    const all = await navigator.mediaDevices.enumerateDevices();
    tracks = all
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => describe(device, index));
    return tracks;
  };

  const open = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    const next = await navigator.mediaDevices.getUserMedia(constraints);
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

  const openPreferred = async (): Promise<void> => {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(STORAGE_KEY);
    } catch {
      remembered = null;
    }

    if (remembered) {
      try {
        await open({ video: { deviceId: { exact: remembered } } });
        return;
      } catch {
        // The saved camera is gone; fall through to the default.
      }
    }

    try {
      await open({ video: { facingMode: { ideal: 'environment' } } });
    } catch {
      await open({ video: true });
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
          failure instanceof Error
            ? `Decoding is not working (${failure.message}). Check the decoder you passed in.`
            : 'Decoding is not working. Check the decoder you passed in.',
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
    void enumerate();
  };

  const select = async (id: string): Promise<void> => {
    try {
      await open({ video: { deviceId: { exact: id } } });
    } catch {
      report('That camera could not be opened. Falling back to the default camera.');
      await open({ video: { facingMode: { ideal: 'environment' } } });
    }
  };

  try {
    await openPreferred();
    if (options.deviceId) await select(options.deviceId);
  } catch (error) {
    report(
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow camera access and reload.'
        : 'No camera available.',
    );
    throw error;
  }

  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);


  schedule();

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
      const previous = active;
      await open(
        previous
          ? { video: { deviceId: { exact: previous } } }
          : { video: { facingMode: { ideal: 'environment' } } },
      );
    },

    zoomRange() {
      const track = stream?.getVideoTracks()[0];
      const zoom = (track?.getCapabilities() as CameraCapabilities | undefined)?.zoom;
      if (!zoom) return null;
      return { min: zoom.min, max: zoom.max, step: zoom.step ?? 0.1 };
    },

    async setZoom(value: number): Promise<void> {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      try {
        // `zoom` is a Chrome extension, absent from the DOM constraint types.
        await track.applyConstraints({ advanced: [{ zoom: value } as unknown as MediaTrackConstraintSet] });
      } catch {
        report('This camera does not accept a zoom setting.');
      }
    },

    stop(): void {
      stopped = true;
      cancelAnimationFrame(frameHandle);
      if (timerHandle) clearTimeout(timerHandle);
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
      video.srcObject = null;
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    },

    onSymbol(callback: (bytes: Uint8Array) => void): void {
      symbolHandler = callback;
    },

    onError(callback: (error: string) => void): void {
      errorHandler = callback;
    },
  };
}
