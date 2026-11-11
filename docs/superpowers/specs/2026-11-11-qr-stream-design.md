# qr-stream — Design

**Status:** approved
**Date:** 2026-11-11

## Intent

Move a JSON file (maximum 1 MiB) between two devices with no network, pairing, NFC, or Bluetooth. One screen animates a sequence of QR codes; the other device's camera reads them. Delivered as a React library with a demo PWA, 100% static, installable, and usable fully offline.

Why QR: it is the only channel that crosses an airgap from a phone without a radio handshake, and it works on two locked-down devices where neither side can request network permission.

## Goals

- Reliable one-way transfer of a JSON file up to 1 MiB.
- Correctness proven by hash, not by hope.
- Optional encryption whose key never touches the screen.
- Separable pieces: a DOM-free codec, a browser renderer/reader, and React bindings that other projects can reuse.
- Works in Safari on iOS, where `BarcodeDetector` is unavailable.
- The codec runs in Node, so reliability can be proven without a camera.

## Non-goals

- Resuming across a page reload; a human restarts the transfer.
- Multiple files or folders. One file, one transfer.
- File formats other than JSON in the MVP, though the codec must not assume JSON.
- Two-way streams, chat, or transfer history.
- Beating roughly 15 KB/s.

## Anti-goals

- A transfer that reports success while the bytes are wrong.
- "Encryption" whose key travels inside the QR stream.
- Requiring the receiver to hunt for a specific missing frame by hand.
- A QR that changes version mid-stream, forcing the camera to re-hunt scale.

## Constraints

- iOS Safari has no `BarcodeDetector`; a WASM QR decoder is required.
- `BarcodeDetector` cannot carry this stream even where it exists: it exposes
  `rawValue` as a string, and a measured binary packet decodes to an empty
  string while an ASCII payload round-trips byte-perfect.
- `getUserMedia` requires a secure context (HTTPS or localhost).
- Phone screens are ~390 pt wide; a version-40 QR is 177 modules across.
- Display refresh is 60 Hz; a code updated mid-refresh is unreadable.
- 1 MiB of incompressible data is roughly two minutes of scanning at best;
  1 MiB of JSON compresses 3-8x and finishes in well under a minute.
- Static hosting only; no backend.

## Approaches considered

**A. Pure core plus two dependencies — chosen.** Hand-written CRC-32, packet codec, fountain codec, and crypto; bought QR matrix generation and QR decoding. ~350 lines of codec, and the only genuinely hard dependency is QR itself. Keeping the core DOM-free makes a camera-free proof of reliability possible.

**B. `@raptorqr/core`.** RaptorQ for free at ~1–2% fountain overhead. Rejected: version 0.1.1, ships raw TypeScript source, single publish, and the app around it carries no licence.

**C. BC-UR / Multipart UR.** Interoperable with hardware wallets. Rejected: Bytewords costs ~27% of QR capacity and the libraries are beta or stale. Only worth it if a hardware wallet must read the stream.

## Decisions

| Decision | Choice | Made by |
|---|---|---|
| Reliability model | Systematic Luby-Transform fountain code | user |
| Key | Passphrase spoken aloud, typed on both devices, optional (blank = none) | user |
| Payload | JSON only, 1 MiB cap | user |
| Resume across reload | No — a human restarts | user |
| Codec | Hand-written; only QR encode/decode bought | user |
| UI layer | React components + hooks | user |
| Hosting | 100% static, offline PWA | user |
| Frame ECC | Always `L` | designer |
| Density presets instead of raw version | Three presets + override | designer |
| Metadata in block 0, not a repeated beacon | Zero extra frames | designer |
| Sender fps hint in stream | Removed; receiver shows an absolute rate | designer |
| Wrong passphrase | Keep ciphertext, allow retry | designer |

Rationale worth keeping:

- **ECC `L` always.** Every frame carries a CRC-32, so a misread frame is dropped and becomes an erasure the fountain code already absorbs. Raising ECC buys tolerance twice, at 20–40% capacity cost.
- **fps hint removed.** It goes stale the moment a human says "slower", which is the main use case. The receiver reports `symbols/sec`; both people are in the same room, so comparing it to the sender's on-screen fps is a glance.
- **Density and passphrase changes restart the stream** (they change `blockSize` and `K`). FPS is live-adjustable.

## Pipeline

Encode:

```
JSON bytes (<= 250 KB)
  -> gzip via CompressionStream            (only when it shrinks)
  -> AES-256-GCM whole payload             (only when a passphrase is given)
  -> meta block: filename, lengths, sha256(plaintext), salt, nonce, iterations
  -> payload = varint(metaLen) || meta || wireBytes
  -> K blocks of blockSize bytes, zero-padded
  -> systematic LT: symbols 0..K-1 raw, K.. are XOR combinations
  -> packet: 16-byte header || payload || crc32
  -> QR byte mode, fixed version, ECC L
```

Decode inverts it: CRC gate → drop bad frames → fountain → decrypt → gunzip → SHA-256 → UI.

## Wire format

Every frame is the same size. The payload is zero-padded to `blockSize` so the QR version never changes mid-stream.

| Offset | Size | Field | Meaning |
|---|---|---|---|
| 0 | 2 | `magic` | `QS`, rejects foreign QR codes |
| 2 | 1 | `version` | Wire format version, `1` |
| 3 | 1 | `flags` | bit0 `gzip`, bit1 `encrypted` |
| 4 | 4 | `sessionId` | Random per transfer; receiver locks to the first seen |
| 8 | 2 | `symbolIdx` | `< K` source block, `>= K` repair symbol |
| 10 | 2 | `K` | Source block count |
| 12 | 2 | `blockSize` | `capacity(version) - 20` |
| 14 | 2 | `payloadLen` | Meaningful bytes; only the last source block is short |
| 16 | `blockSize` | `payload` | Zero-padded |
| 16+N | 4 | `crc32` | IEEE 802.3 over the preceding bytes |

`symbolIdx` for repairs cycles with period `65535 - K`.

Metadata is carried inside block 0: `varint metaVersion`, `u8 filenameLen + utf8`, `u32 plainLen`, `u32 wireLen`, `32B sha256`, `u16 saltLen + salt`, `u16 nonceLen + nonce`, `u32 iterations`.

| Preset | Version | Bytes/frame | fps |
|---|---|---|---|
| fast | 20 | 838 | 15 |
| balanced | 25 | 1253 | 12 |
| dense | 30 | 1712 | 10 |
| extreme | 40 | 2933 | 6 |

## Fountain codec

Systematic LT with an integer PRNG, so sender and receiver agree bit-for-bit with nothing transmitted about the XOR set.

- Degree: uniform over `1..K`, indices chosen by rejection sampling.
- PRNG: `splitmix32(sessionId ^ symbolIdx)`.
- Decoder: peeling (solve any equation with one unsolved bit, substitute, repeat); GF(2) Gaussian elimination over `bigint` masks when peeling stalls.
- Reliability target: reconstruct from `1.75 * K` symbols under 30% random erasure and 30% contiguous erasure, at most 1 failure in 1000 trials.

The degree distribution was settled by measurement, not theory. A sparse distribution (50% degree-1, flat tail to 20) failed 14% of 30-block transfers at 1.5×K: half the repair symbols were duplicates of one block and added no rank. A robust-soliton split (mass on degree 2–3 plus a spike at √K) made it worse (30%), because the surviving rank deficiency is in the projected matrix, not in peeling. Dense uniform subsets plus Gaussian elimination measured 0/1000 at 1.75×K for both erasure models, and 1.15×K already works at K=306, where larger matrices are better conditioned. Peeling is largely bypassed at small K, which is acceptable: `K` never exceeds a few hundred, so elimination is cheap.

## Encryption

`PBKDF2-SHA256(passphrase.normalize('NFKC').trim(), salt, 600000)` → AES-256-GCM, 12-byte nonce, tag appended. Encrypt the whole compressed payload once, never per block: a repair symbol is an XOR of several ciphertext blocks, so per-block nonces would make decoding depend on decryption and deadlock. Decode order is decrypt → gunzip; a GCM failure is `WrongKeyError`, reported distinctly from corruption.

## Rendering

Render at 1 px per module into an offscreen canvas, blit with `imageSmoothingEnabled = false` at an integer scale derived from `devicePixelRatio`. No CSS transforms, no fractional scaling. FPS is quantised to `refreshHz / n`.

## Camera

- Request `facingMode: 'environment'`, then `enumerateDevices()`; labels are empty before permission.
- Switching: stop all tracks, then request `{ deviceId: { exact: id } }` **alone** (`deviceId` and `facingMode` conflict), catch `OverconstrainedError`/`NotFoundError` and fall back to `environment`.
- Re-enumerate after each switch; ids can renumber. Listen for `devicechange`.
- Decode with `requestVideoFrameCallback` where available; draw to an offscreen canvas at `videoWidth`/`videoHeight` and downscale to 1280 max.
- Switching cameras never touches fountain state.

On Android, multiple rear cameras are advertised and the wrong one often will not scan — ultrawide and telephoto modules have different minimum focus distances. Hence a camera picker (`auto` shows it only when more than one device exists) plus a one-tap cycle button.

## Package shape

Single package, subpath exports, demo app beside it.

```
src/core/     no DOM, no React
src/qr/       packet -> matrix -> RGBA
src/browser/  canvas pacing, camera
src/react/    components + hooks
demo/         Vite + React PWA
```

Public API:

```ts
createQrStreamWriter(data, opts): Promise<QrStreamWriter>   // .packets() is infinite
createQrStreamReader(): QrStreamReader                      // .add(bytes), .result(pass?)
renderQrStream({ packets, canvas, fps, version }): RenderController
readQrStream({ video, decoder }): Promise<CameraController>
```

## Serverless and offline

Static files only. Two failure modes to guard:

- `getUserMedia` needs a secure context, so the receiving device must load the app once from an HTTPS origin before it can be installed and used offline.
- The WASM decoder must be precached. `vite-plugin-pwa` will not include a `.wasm` from `node_modules` unless `'**/*.wasm'` is added to `workbox.globPatterns`. Missing this makes the receiver work online and fail in the airgap.

## Decoding

The decoder is injected, not built in. `readQrStream` requires a
`FrameDecoder`, `qr-stream/browser` imports no QR library, and `zxing-wasm` is
an optional peer reached only through `qr-stream/browser/zxing`. That keeps the
choice of shipped bytes with the consuming project instead of with this one.

## Testing

1. Packet round-trip and single-byte corruption rejection.
2. Fountain: 30% random erasure, ≤1 failure in 1000 trials.
3. Fountain: 30% contiguous erasure, same bound.
4. Crypto: round-trip; wrong passphrase distinguishable from corruption.
5. QR matrix golden values and capacity boundaries.
6. Full pipeline in Node with 25% loss.
7. **Loopback:** render real frames to RGBA, decode with the same zxing-wasm build, assert the bytes survive. Highest-value test; density bugs are silent.
8. PWA: offline reload after install.

## Left to the builder

Styling and copy; torch toggle; npm scope (use `@orozcoh/qr-stream` unless `qr-stream` is free); whether to publish at all.
