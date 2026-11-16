import { afterEach, describe, expect, test, vi } from 'vitest';
import { createZXingDecoder } from '../src/browser/decoders/zxing';

const { prepareZXingModule } = vi.hoisted(() => ({ prepareZXingModule: vi.fn() }));

vi.mock('zxing-wasm/reader', () => ({
  prepareZXingModule,
  readBarcodes: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('createZXingDecoder', () => {
  test('rejects missing options before touching the wasm loader', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(createZXingDecoder(undefined as never)).rejects.toMatchObject({
      name: 'QrStreamError',
      code: 'INVALID_ARGUMENT',
      recovery: 'none',
    });

    expect(prepareZXingModule).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects an empty wasmUrl before touching the wasm loader', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(createZXingDecoder({ wasmUrl: '' })).rejects.toMatchObject({
      name: 'QrStreamError',
      code: 'INVALID_ARGUMENT',
      recovery: 'none',
    });

    expect(prepareZXingModule).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
