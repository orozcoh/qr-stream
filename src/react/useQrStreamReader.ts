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
  /** Frames from a different transfer keep arriving while this one is stuck. */
  stale: boolean;
  error: string | null;
  add(bytes: Uint8Array): void;
  retryKey(passphrase: string): Promise<void>;
  reset(): void;
}

const RATE_WINDOW_MS = 1000;
/** Consecutive foreign frames before we offer to abandon the locked session. */
const STALE_PROMPT_THRESHOLD = 12;

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
  const finishingRef = useRef(false);
  const failedHardRef = useRef(false);
  const staleRef = useRef(0);
  const epochRef = useRef(0);
  const finishedRef = useRef(false);

  const [progress, setProgress] = useState({ solved: 0, k: 0 });
  const [solveRate, setSolveRate] = useState(0);
  const [result, setResult] = useState<{ data: Uint8Array; meta: StreamMeta } | null>(null);
  const [wrongKey, setWrongKey] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(async (passphrase: string | undefined) => {
    // One derivation at a time: a burst of frames arriving together must not
    // start several 600k-iteration PBKDF2 jobs.
    if (finishingRef.current || failedHardRef.current) return;
    finishingRef.current = true;
    const myEpoch = epochRef.current;
    try {
      const assembled = await readerRef.current.result(passphrase);
      // A reset or a second session while the derivation was in flight must not
      // deliver the abandoned transfer.
      if (epochRef.current !== myEpoch) return;
      if (assembled === null) return;
      setResult(assembled);
      setWrongKey(false);
      setError(null);
    } catch (cause) {
      if (epochRef.current !== myEpoch) return;
      if (cause instanceof WrongKeyError) {
        setWrongKey(true);
        setError('That passphrase does not match. Try again — no need to rescan.');
      } else {
        // A checksum or decompression failure will fail identically forever;
        // retrying it at camera frame rate would spin.
        failedHardRef.current = true;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      finishingRef.current = false;
    }
  }, []);

  const add = useCallback(
    (bytes: Uint8Array) => {
      const outcome = readerRef.current.add(bytes);

      if (outcome === 'stale-session') {
        staleRef.current += 1;
        if (staleRef.current === STALE_PROMPT_THRESHOLD) setStale(true);
        return;
      }
      if (outcome !== 'accepted') return;

      staleRef.current = 0;
      setStale(false);

      const now = performance.now();
      const stamps = stampsRef.current;
      stamps.push(now);
      while (stamps.length > 0 && now - (stamps[0] as number) > RATE_WINDOW_MS) stamps.shift();

      const next = readerRef.current.progress();
      setProgress(next);
      setSolveRate(stamps.length);

      if (next.k > 0 && next.solved === next.k && !finishedRef.current) {
        // Completion is a one-shot event. Further frames are still accepted by
        // the core reader as duplicates, but they must not re-run PBKDF2 or
        // re-fire the host callback.
        finishedRef.current = true;
        void finish(options.passphrase);
      }
    },
    [finish, options.passphrase],
  );

  const retryKey = useCallback(
    async (passphrase: string) => {
      failedHardRef.current = false;
      await finish(passphrase);
    },
    [finish],
  );

  const reset = useCallback(() => {
    readerRef.current.reset();
    stampsRef.current = [];
    finishingRef.current = false;
    failedHardRef.current = false;
    staleRef.current = 0;
    epochRef.current += 1;
    finishedRef.current = false;
    setProgress({ solved: 0, k: 0 });
    setSolveRate(0);
    setResult(null);
    setWrongKey(false);
    setStale(false);
    setError(null);
  }, []);

  return useMemo(
    () => ({ progress, solveRate, result, wrongKey, stale, error, add, retryKey, reset }),
    [progress, solveRate, result, wrongKey, stale, error, add, retryKey, reset],
  );
}
