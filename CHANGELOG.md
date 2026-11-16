# Changelog

## 0.3.0 — 2026-11-16

### Added

- React 18 support: the peer range is now `>=18`, with a React 18 typecheck
  fixture (`pnpm typecheck:react18`).
- `QrStreamWriter` describes the stream without decoding it: `version`,
  `preset`, `plainBytes`, `wireBytes`, `payloadBytes`, and `encrypted`.
- `renderQrStream({ writer })` renders directly from a writer; raw packets plus
  an explicit version remain supported.
- Wire-based limits: `MAX_WIRE_BYTES` (1 MiB compressed body),
  `MAX_INPUT_BYTES` (8 MiB raw input), `MAX_DECODED_BYTES` (8 MiB decoded), and
  per-call `limits` that may only tighten the defaults.
- Stable `QrStreamErrorCode`s and typed errors (`QrStreamError`,
  `PayloadTooLargeError`, `WrongKeyError`, `CameraError`, `DecoderError`,
  `RenderError`), each carrying a `recovery` hint, plus `isQrStreamError`.
- `useCameraReader` exposes `start()`, `stop()`, `enabled`, `starting`,
  `torch`, `torchSupported`, and `setTorch()`; camera failures arrive as typed
  `QrStreamError`s.
- The packaged components accept `strings` overrides (with packaged defaults)
  and a `formatError` prop; accessibility fixes include labelled preview and
  canvas, `role="alert"` errors, and progress announcements.
- `matrixToRGBA` accepts foreground/background colors and `renderQrStream`
  accepts an explicit `size`.
- `docs/integration.md`: PWA/WASM precaching, headless camera lifecycle, limits,
  and error handling for host applications.

### Changed

- The writer budgets post-compression wire bytes rather than only raw input. A
  compressible JSON payload above 1 MiB is now accepted by default.
- The reader accepts up to 8 MiB of decompressed output by default; the wire
  body remains capped at 1 MiB.
- Domain errors are `QrStreamError` subclasses, so `instanceof RangeError` is no
  longer guaranteed.
- `readQrStream` setup failures reject with `CameraError` (the original
  `DOMException` is in `cause`) instead of the raw `DOMException`.
- `MAX_INPUT_BYTES` now documents the 8 MiB raw-input budget instead of acting
  as the 1 MiB wire cap; `MAX_WIRE_BYTES` is the transfer budget.

### Compatibility

- The wire format is unchanged. 0.2 and 0.3 exchange plaintext up to 1 MiB and
  encrypted streams in both directions.
- A 0.2 receiver rejects a 0.3 stream whose plaintext exceeds 1 MiB; set
  `limits: { maxInputBytes: 1024 * 1024 }` on the sender for mixed-version
  deployments. See
  [Limits and version compatibility](docs/integration.md#5-limits-and-version-compatibility).

## 0.2.0 — 2026-11-12

### Security

- Bound the receiver's peer-declared `K` and `blockSize`, lock the session
  parameters (`sessionId`, `K`, `blockSize`, `flags`), and reject frames after
  completion. A 21-byte frame can no longer drive unbounded fountain work.
- Stream the 1 MiB decompression budget and abort at the cap instead of
  buffering the whole expansion.
- Authenticate the metadata block as AES-GCM additional authenticated data;
  validate `plainLen`, salt/nonce lengths, and iterations; strip control,
  bidi, and path-separator characters from filenames; reject non-canonical
  varints and trailing metadata bytes.
- Make completion one-shot and memoize the verified result; add a reset
  generation so an in-flight result cannot cross a reset.
- Release the camera when the receiver unmounts during decoder initialization.
- Bind Start to the current writer settings; clear the canvas when the render
  controller stops.
- Add CSP/HSTS, split CI verification from deployment, pin actions to commit
  SHAs, and scope the Cloudflare credentials to the `production` environment.

### Changed

- Encrypted streams are **not wire-compatible with `0.1.x`** because of the
  metadata AAD. Update both devices before transferring.
- `gunzip` caps output at 1 MiB by default.
- `decodeMeta` rejects trailing bytes and non-canonical varints.
- `reader.result()` returns the same cached `Uint8Array` reference on repeat
  calls; treat it as read-only.
- `verify.yml` runs on pull requests; `deploy.yml` runs on pushes to `main` and
  manual dispatch from `main`. A PR is recommended but not required by the
  workflow.

### Fixed

- Camera left live after an unmount during decoder initialization.
- Repeated `onComplete` calls and PBKDF2 work after a completed transfer.
- Stale cleartext writer window after a passphrase change.
- Last QR frame remaining scannable after Stop.
