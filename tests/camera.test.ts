import { afterEach, describe, expect, test, vi } from 'vitest';
import { readQrStream, type CameraCapabilities } from '../src/browser/camera';
import type { QrStreamError } from '../src/core/errors';

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason?: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeTrackOptions {
  capabilities?: CameraCapabilities;
  applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
}

function fakeTrack(deviceId: string, stop: () => void, options: FakeTrackOptions = {}) {
  return {
    stop,
    getSettings: () => ({ deviceId }),
    getCapabilities: () => options.capabilities ?? {},
    label: deviceId,
    applyConstraints: vi.fn(options.applyConstraints ?? (async () => undefined)),
  };
}

type FakeTrack = ReturnType<typeof fakeTrack>;

function fakeStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

interface FakeCameraOptions {
  media?(constraints: MediaStreamConstraints): Promise<MediaStream>;
  remembered?: string | null;
  devices?: MediaDeviceInfo[];
}

/** Stubs the DOM surface `readQrStream` touches, plus getUserMedia. */
function stubCamera(options: FakeCameraOptions = {}) {
  const video = {
    srcObject: null,
    videoWidth: 640,
    videoHeight: 480,
    play: async () => undefined,
    requestVideoFrameCallback: () => 0,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLVideoElement;

  const context = {
    drawImage: () => undefined,
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  };
  const canvas = { width: 0, height: 0, getContext: () => context };

  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('localStorage', { getItem: () => options.remembered ?? null, setItem: () => undefined });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  const getUserMedia = vi.fn(options.media ?? (async () => fakeStream(fakeTrack('cam-1', () => undefined))));
  const mediaDevices = {
    getUserMedia,
    enumerateDevices: vi.fn(async () => options.devices ?? []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('navigator', { mediaDevices });

  return { video, mediaDevices, getUserMedia };
}

const silentDecoder = { decode: async () => null };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('camera lifecycle', () => {
  test('stop during an in-flight switch releases the new track and disposes the decoder', async () => {
    const { video } = stubCamera({ remembered: null });
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const first = fakeStream(fakeTrack('cam-1', firstStop));
    const second = fakeStream(fakeTrack('cam-2', secondStop));
    const secondGate = deferred<MediaStream>();

    let calls = 0;
    const mediaDevices = {
      getUserMedia: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? first : secondGate.promise;
      }),
      enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'cam-1', label: 'cam-1', groupId: 'g1' }]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('navigator', { mediaDevices });
    void video;

    const dispose = vi.fn();
    const controller = await readQrStream({
      video,
      decode: { decode: async () => null, dispose },
    });

    const selecting = controller.select('cam-2');
    controller.stop();
    secondGate.resolve(second);
    await expect(selecting).resolves.toBeUndefined();

    expect(secondStop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('releases the stream when setup fails after acquisition', async () => {
    const { video } = stubCamera();
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const first = fakeStream(fakeTrack('cam-1', firstStop));
    const second = fakeStream(fakeTrack('cam-2', secondStop));
    let calls = 0;

    const mediaDevices = {
      getUserMedia: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? first : second;
      }),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('navigator', { mediaDevices });

    const dispose = vi.fn();
    await expect(
      readQrStream({
        video: null as unknown as HTMLVideoElement,
        decode: { decode: async () => null, dispose },
      }),
    ).rejects.toMatchObject({ code: 'CAMERA_UNAVAILABLE' });

    expect(calls).toBe(2);
    expect(secondStop).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    void video;
  });
});

describe('camera constraints', () => {
  test('applies the caller video constraints on every open', async () => {
    const { video, getUserMedia } = stubCamera();
    const controller = await readQrStream({
      video,
      decode: silentDecoder,
      videoConstraints: { width: { ideal: 1920 } },
    });

    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { width: { ideal: 1920 }, facingMode: { ideal: 'environment' } },
    });

    await controller.select('cam-2');
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { width: { ideal: 1920 }, deviceId: { exact: 'cam-2' } },
    });
    controller.stop();
  });

  test('select overrides deviceId without keeping a conflicting facingMode', async () => {
    const { video, getUserMedia } = stubCamera();
    const controller = await readQrStream({
      video,
      decode: silentDecoder,
      videoConstraints: { width: { ideal: 1920 }, facingMode: { exact: 'environment' } },
    });

    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { width: { ideal: 1920 }, facingMode: { exact: 'environment' } },
    });

    await controller.select('cam-2');
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { width: { ideal: 1920 }, deviceId: { exact: 'cam-2' } },
    });
    controller.stop();
  });

  test('opens the remembered device without a conflicting caller facingMode', async () => {
    const { video, getUserMedia } = stubCamera({ remembered: 'cam-old' });
    const controller = await readQrStream({
      video,
      decode: silentDecoder,
      videoConstraints: { facingMode: { exact: 'environment' } },
    });

    expect(getUserMedia).toHaveBeenNthCalledWith(1, { video: { deviceId: { exact: 'cam-old' } } });
    controller.stop();
  });

  test('applyConstraints forwards constraints and rejects when the track refuses them', async () => {
    const track = fakeTrack('cam-1', () => undefined);
    const { video } = stubCamera({ media: async () => fakeStream(track) });
    const controller = await readQrStream({ video, decode: silentDecoder });

    await controller.applyConstraints({ width: { ideal: 640 } });
    expect(track.applyConstraints).toHaveBeenCalledWith({ width: { ideal: 640 } });

    track.applyConstraints.mockRejectedValueOnce(new DOMException('no', 'OverconstrainedError'));
    await expect(controller.applyConstraints({ width: { ideal: 4000 } })).rejects.toMatchObject({
      name: 'CameraError',
      code: 'CAMERA_CONSTRAINTS_FAILED',
      cause: expect.any(DOMException),
    });
    controller.stop();
  });
});

describe('camera errors', () => {
  test('permission failure rejects a coded CameraError with cause', async () => {
    const denied = new DOMException('denied', 'NotAllowedError');
    const { video } = stubCamera({
      media: async () => {
        throw denied;
      },
    });

    await expect(readQrStream({ video, decode: silentDecoder })).rejects.toMatchObject({
      name: 'CameraError',
      code: 'CAMERA_PERMISSION_DENIED',
      recovery: 'grant-permission',
      cause: denied,
    });
  });

  test.each([
    ['NotFoundError', 'CAMERA_NOT_FOUND'],
    ['NotReadableError', 'CAMERA_IN_USE'],
    ['OverconstrainedError', 'CAMERA_CONSTRAINTS_FAILED'],
    ['UnknownError', 'CAMERA_UNAVAILABLE'],
  ])('maps %s to %s with a cause', async (name, code) => {
    const cause = new DOMException(name, name);
    const { video } = stubCamera({
      media: async () => {
        throw cause;
      },
    });

    await expect(readQrStream({ video, decode: silentDecoder })).rejects.toMatchObject({
      name: 'CameraError',
      code,
      recovery: 'change-camera',
      cause,
    });
  });

  test('mutations without a live track reject CAMERA_UNAVAILABLE and report it', async () => {
    const emptyStream = { getTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream;
    const { video } = stubCamera({ media: async () => emptyStream });
    const controller = await readQrStream({ video, decode: silentDecoder });
    const errors: QrStreamError[] = [];
    controller.onError((error) => errors.push(error));

    await expect(controller.setZoom(2)).rejects.toMatchObject({
      name: 'CameraError',
      code: 'CAMERA_UNAVAILABLE',
      recovery: 'change-camera',
    });
    await expect(controller.applyConstraints({ width: { ideal: 640 } })).rejects.toMatchObject({
      name: 'CameraError',
      code: 'CAMERA_UNAVAILABLE',
      recovery: 'change-camera',
    });

    expect(errors.map((error) => error.code)).toEqual(['CAMERA_UNAVAILABLE', 'CAMERA_UNAVAILABLE']);
    controller.stop();
  });

  test('select rejects a coded CameraError and reports it', async () => {
    const first = fakeStream(fakeTrack('cam-1', () => undefined));
    let calls = 0;
    const { video } = stubCamera({
      media: async () => {
        calls += 1;
        if (calls === 1) return first;
        throw new DOMException('busy', 'NotReadableError');
      },
    });
    const controller = await readQrStream({ video, decode: silentDecoder });
    const errors: QrStreamError[] = [];
    controller.onError((error) => errors.push(error));

    await expect(controller.select('cam-2')).rejects.toMatchObject({
      name: 'CameraError',
      code: 'CAMERA_IN_USE',
      cause: expect.any(DOMException),
    });
    expect(errors.map((error) => error.code)).toEqual(['CAMERA_IN_USE']);
    expect(controller.activeId()).toBeNull();
    controller.stop();
  });

  test('rescan rejects on a failed reopen and leaves the controller stopped', async () => {
    const stopTrack = vi.fn();
    const first = fakeStream(fakeTrack('cam-1', stopTrack));
    let calls = 0;
    const { video } = stubCamera({
      media: async () => {
        calls += 1;
        if (calls === 1) return first;
        throw new DOMException('busy', 'NotReadableError');
      },
    });
    const controller = await readQrStream({ video, decode: silentDecoder });
    expect(controller.diagnostics().active?.deviceId).toBe('cam-1');

    await expect(controller.rescan()).rejects.toMatchObject({
      name: 'CameraError',
      code: 'CAMERA_IN_USE',
      cause: expect.any(DOMException),
    });

    expect(stopTrack).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(controller.activeId()).toBeNull();
    expect(controller.diagnostics().active).toBeNull();
  });

  test('setZoom rejects CAMERA_CONSTRAINTS_FAILED and reports the same typed error', async () => {
    const cause = new DOMException('bad zoom', 'OverconstrainedError');
    const track = fakeTrack('cam-1', () => undefined, {
      applyConstraints: async () => {
        throw cause;
      },
    });
    const { video } = stubCamera({ media: async () => fakeStream(track) });
    const controller = await readQrStream({ video, decode: silentDecoder });
    const messages: string[] = [];
    controller.onError((error) => messages.push(error.message));

    const rejection = (await controller.setZoom(999).catch((error: unknown) => error)) as QrStreamError;

    expect(rejection).toMatchObject({
      name: 'CameraError',
      code: 'CAMERA_CONSTRAINTS_FAILED',
      cause,
    });
    expect(messages).toEqual([rejection.message]);
    controller.stop();
  });

  test('reports a DecoderError after sixty consecutive decode failures', async () => {
    const failure = new Error('wasm never loaded');
    const frame: { current: (() => void) | null } = { current: null };
    const { video } = stubCamera();
    (video as unknown as { requestVideoFrameCallback: (callback: () => void) => number }).requestVideoFrameCallback = (
      callback,
    ) => {
      frame.current = callback;
      return 0;
    };

    const controller = await readQrStream({
      video,
      decode: {
        decode: async () => {
          throw failure;
        },
      },
    });
    const errors: QrStreamError[] = [];
    controller.onError((error) => errors.push(error));

    for (let index = 0; index < 60; index += 1) {
      const callback = frame.current;
      frame.current = null;
      callback?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'DECODER_FAILED', cause: failure });
    controller.stop();
  });
});
