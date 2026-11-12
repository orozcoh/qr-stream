import { afterEach, describe, expect, test, vi } from 'vitest';
import { readQrStream } from '../src/browser/camera';

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason?: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeTrack(deviceId: string, stop: () => void) {
  return {
    stop,
    getSettings: () => ({ deviceId }),
    getCapabilities: () => ({}),
    label: deviceId,
    applyConstraints: async () => undefined,
  };
}

function fakeStream(track: ReturnType<typeof fakeTrack>): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('camera lifecycle', () => {
  test('stop during an in-flight switch releases the new track and disposes the decoder', async () => {
    const video = {
      srcObject: null,
      videoWidth: 0,
      videoHeight: 0,
      play: async () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as HTMLVideoElement;

    const context = {
      drawImage: () => undefined,
      getImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
    };
    const canvas = { width: 0, height: 0, getContext: () => context };

    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

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
      enumerateDevices: vi.fn(async () => [
        { kind: 'videoinput', deviceId: 'cam-1', label: 'cam-1', groupId: 'g1' },
      ]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('navigator', { mediaDevices });

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
});
