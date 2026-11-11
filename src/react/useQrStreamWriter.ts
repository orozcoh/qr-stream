import { useEffect, useRef, useState } from 'react';
import { createQrStreamWriter, type QrStreamWriter } from '../core/writer';
import type { PresetName } from '../core/types';

export interface UseQrStreamWriterOptions {
  data: Uint8Array | null;
  filename: string;
  preset: PresetName;
  passphrase?: string;
}

export interface UseQrStreamWriterResult {
  writer: QrStreamWriter | null;
  error: Error | null;
}

/** Builds a writer whenever the input or settings change; cancels in flight. */
export function useQrStreamWriter(options: UseQrStreamWriterOptions): UseQrStreamWriterResult {
  const [writer, setWriter] = useState<QrStreamWriter | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const { data, filename, preset, passphrase } = options;

  useEffect(() => {
    if (data === null) {
      setWriter(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);

    createQrStreamWriter(data, {
      filename,
      preset,
      ...(passphrase ? { passphrase } : {}),
    })
      .then((created) => {
        if (!cancelled) setWriter(created);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setWriter(null);
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data, filename, preset, passphrase]);

  return { writer, error };
}
