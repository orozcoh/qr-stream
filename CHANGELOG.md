# Changelog

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
