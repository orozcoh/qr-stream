import { useEffect, useMemo, useState } from 'react';
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
  /** True while a writer for the current settings is being rebuilt. */
  pending: boolean;
}

interface WriterState {
  /** Identity of the settings that produced this writer. */
  key: object;
  writer: QrStreamWriter;
}

/** Builds a writer whenever the input or settings change; cancels in flight. */
export function useQrStreamWriter(options: UseQrStreamWriterOptions): UseQrStreamWriterResult {
  const { data, filename, preset, passphrase } = options;

  // A fresh object whenever any input changes. Comparing this identity is the
  // only state that Start may trust: it is updated during render, whereas the
  // effect that builds the next writer runs after the render. Without it, the
  // passphrase-changed render still sees the previous cleartext writer.
  const settingsKey = useMemo(() => ({}), [data, filename, preset, passphrase]);
  const [state, setState] = useState<WriterState | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (data === null) {
      setState(null);
      return;
    }

    let cancelled = false;
    createQrStreamWriter(data, {
      filename,
      preset,
      ...(passphrase ? { passphrase } : {}),
    })
      .then((created) => {
        if (!cancelled) setState({ key: settingsKey, writer: created });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState(null);
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });

    return () => {
      cancelled = true;
    };
    // `settingsKey` changes whenever data/filename/preset/passphrase change; the
    // effect reads the current values from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  const writer = state !== null && state.key === settingsKey ? state.writer : null;
  const pending = data !== null && writer === null && error === null;
  return { writer, error, pending };
}
