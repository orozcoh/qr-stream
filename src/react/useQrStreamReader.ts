import { useCallback, useMemo, useRef, useState } from 'react';
import { WrongKeyError } from '../core/crypto';
import type { StreamMeta } from '../core/meta';
import { createQrStreamReader } from '../core/reader';

export interface UseQrStreamReaderOptions {
  passphrase?: string;
}

export interface UseQrStreamReaderResult {
  progress: { solved: number; k: number };
  /** Symbols accepted in the last second — the number the human reads off. */
  solveRate: number;
  result: { data: Uint8Array; meta: StreamMeta } | null;
  wrongKey: boolean;
  error: string | null;
  add(bytes: Uint8Array): void;
  retryKey(passphrase: string): Promise<void>;
  reset(): void;
}

const RATE_WINDOW_MS = 1000;

/**
 * Reassembles a stream and reports how fast it is going.
 *
 * `solveRate` is an absolute number rather than a comparison against the
 * sender: the two people are in the same room, so one glance at the sender's
 * displayed fps is a better signal than anything the receiver could infer.
 */
export function useQrStreamReader(options: UseQrStreamReaderOptions = {}): UseQrStreamReaderResult {
  const readerRef = useRef(createQrStreamReader());
  const stampsRef = useRef<number[]>([]);
  const [progress, setProgress] = useState({ solved: 0, k: 0 });
  const [solveRate, setSolveRate] = useState(0);
  const [result, setResult] = useState<{ data: Uint8Array; meta: StreamMeta } | null>(null);
  const [wrongKey, setWrongKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(async (passphrase: string | undefined) => {
    try {
      const assembled = await readerRef.current.result(passphrase);
      if (assembled === null) return;
      setResult(assembled);
      setWrongKey(false);
      setError(null);
    } catch (cause) {
      if (cause instanceof WrongKeyError) {
        setWrongKey(true);
        setError('That passphrase does not match. Try again — no need to rescan.');
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, []);

  const add = useCallback(
    (bytes: Uint8Array) => {
      const outcome = readerRef.current.add(bytes);
      if (outcome !== 'accepted') return;

      const now = performance.now();
      const stamps = stampsRef.current;
      stamps.push(now);
      while (stamps.length > 0 && now - (stamps[0] as number) > RATE_WINDOW_MS) stamps.shift();

      setProgress(readerRef.current.progress());
      setSolveRate(stamps.length);

      const { solved, k } = readerRef.current.progress();
      if (k > 0 && solved === k && result === null && !wrongKey) {
        void finish(options.passphrase);
      }
    },
    [finish, options.passphrase, result, wrongKey],
  );

  const retryKey = useCallback(
    async (passphrase: string) => {
      await finish(passphrase);
    },
    [finish],
  );

  const reset = useCallback(() => {
    readerRef.current.reset();
    stampsRef.current = [];
    setProgress({ solved: 0, k: 0 });
    setSolveRate(0);
    setResult(null);
    setWrongKey(false);
    setError(null);
  }, []);

  return useMemo(
    () => ({ progress, solveRate, result, wrongKey, error, add, retryKey, reset }),
    [progress, solveRate, result, wrongKey, error, add, retryKey, reset],
  );
}
