# Changelog

## 1.0.0-rc.1 — 2026-11-16

**Release candidate; no new features after this point.** This is a pre-release:
it **will be published** under the `next` dist-tag; publication is pending and
`latest` still resolves to `0.2.0` until the final `1.0.0` publish. The public
API is frozen as documented in `etc/*.api.md`; only regressions and contract
gaps may change before `1.0.0`.

Field validation (two-device matrix + one-week pilot) is pending; no 1.0.0
final claim.

### 1.0 feature surface

- React 18 support (`>=18` peer range) with a dedicated React 18 typecheck and
  runtime fixture.
- One typed error surface: stable `QrStreamErrorCode`s and `QrStreamError`
  subclasses (`PayloadTooLargeError`, `WrongKeyError`, `CameraError`,
  `DecoderError`, `RenderError`), each with a `recovery` hint, plus
  `isQrStreamError`.
- `QrStreamWriter` introspection (`version`, `preset`, `plainBytes`,
  `wireBytes`, `payloadBytes`, `encrypted`) and `renderQrStream({ writer })`.
- Wire-based limits: `MAX_WIRE_BYTES` (1 MiB compressed body),
  `MAX_INPUT_BYTES` (8 MiB raw input), `MAX_DECODED_BYTES` (8 MiB decoded), and
  per-call `limits` that may only tighten the defaults.
- Camera lifecycle on `useCameraReader`: `start()`, `stop()`, `enabled`,
  `starting`, `torch`, `torchSupported`, and `setTorch()`, with camera failures
  surfaced as typed errors.
- Packaged React components with `strings` overrides, a `formatError` prop, and
  accessibility fixes (labelled preview and canvas, `role="alert"` errors,
  progress announcements).
- Colors and explicit `size` for `matrixToRGBA` / `renderQrStream`.
- Guide set: API reference, `docs/integration.md`, `docs/migration-0.2-to-1.0.md`,
  examples, and the demo PWA.

### Hardening (0.4.0 milestone / 0.5.0 internal)

The 0.5.0 milestone was internal only and was never published; its hardening
lands in this RC.

- Property-based fuzz tests for every peer-controlled parser (frame header,
  metadata, varints, gzip budget, fountain parameters).
- Interoperability fixtures for 0.2 streams and cross-version reader/sender
  pairs.
- Browser end-to-end coverage: sender rendering, camera lifecycle, and an
  offline PWA receive.
- Render benchmarks with enforced allocation and time budgets
  (`pnpm bench:check`).
- Committed API report (`etc/*.api.md`) checked in CI, so an API change cannot
  merge silently.
- TypeDoc API reference, buildable docs and examples.
- FOSS infrastructure: `SECURITY.md`, `CONTRIBUTING.md`, release guide, CI
  provenance publish workflow, and the accessibility/i18n checks.

### Compatibility

- The wire format and encryption format are unchanged from 0.2. 0.2 and 1.0
  exchange plaintext up to 1 MiB in both directions, encrypted streams
  included; 0.2 still enforces its 1 MiB plaintext cap on encrypted input. A 0.2
  receiver rejects a 1.0 stream whose plaintext exceeds 1 MiB; set
  `limits: { maxInputBytes: 1024 * 1024 }` on the sender for mixed-version
  deployments. See
  [Limits and version compatibility](docs/integration.md#5-limits-and-version-compatibility).
- The package API changed from 0.2; there are no aliases. The root entry is the
  transfer surface (writer, reader, limits, typed errors); packet, fountain,
  crypto, metadata, varint, PRNG, and CRC-32 helpers are internal and absent
  from `etc/*.api.md`. See
  [Migrating from 0.2 to 1.0](docs/migration-0.2-to-1.0.md).

## 0.3.0 — 2026-11-16

**Never published.** This section is retained as the historical internal
milestone; 0.3.0 never reached npm and `1.0.0-rc.1` supersedes it.

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
  as the 1 MiB raw-input cap; `MAX_WIRE_BYTES` is the transfer budget.

### Compatibility

- The wire format is unchanged. 0.2 and 1.0 exchange plaintext up to 1 MiB and
  encrypted streams in both directions, subject to 0.2's 1 MiB plaintext cap.
- A 0.2 receiver rejects a 1.0 stream whose plaintext exceeds 1 MiB; set
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
