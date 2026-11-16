import { useEffect, useMemo, useState } from 'react';
import { QrStreamError, isQrStreamError } from '../core/errors.js';
import type { PresetName, TransferLimits } from '../core/types.js';
import { createQrStreamWriter, type QrStreamWriter } from '../core/writer.js';

export interface UseQrStreamWriterOptions {
  data: Uint8Array | null;
  filename: string;
  preset: PresetName;
  passphrase?: string;
  /** Transfer budgets. Each value may only tighten the library default. */
  limits?: TransferLimits;
}

export interface UseQrStreamWriterResult {
  writer: QrStreamWriter | null;
  error: QrStreamError | null;
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
  const { data, filename, preset, passphrase, limits } = options;

  // Limits are compared by their primitive values, not by object identity: an
  // inline `limits={{ maxWireBytes: 4096 }}` on every render must not rebuild
  // the writer (and restart a running stream) each time.
  const maxWireBytes = limits?.maxWireBytes;
  const maxInputBytes = limits?.maxInputBytes;

  // A fresh object whenever any input changes. Comparing this identity is the
  // only state that Start may trust: it is updated during render, whereas the
  // effect that builds the next writer runs after the render. Without it, the
  // passphrase-changed render still sees the previous cleartext writer.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the values are identity inputs, not memo inputs
  const settingsKey = useMemo(() => ({}), [data, filename, preset, passphrase, maxWireBytes, maxInputBytes]);
  const [state, setState] = useState<WriterState | null>(null);
  const [error, setError] = useState<QrStreamError | null>(null);

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
      ...(limits ? { limits } : {}),
    })
      .then((created) => {
        if (!cancelled) setState({ key: settingsKey, writer: created });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState(null);
          // Never wrap a library error: its code and recovery are the contract.
          setError(isQrStreamError(cause) ? cause : new QrStreamError('INVALID_ARGUMENT', String(cause), { cause }));
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
