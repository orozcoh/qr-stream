# Troubleshooting

Start from the error's `code`, not its message. Messages are human-readable and
may change; `code` and `recovery` are the stable API. If you only have a string,
log the whole `QrStreamError` — `isQrStreamError` tells you whether it is one.

- [DECODER_FAILED or offline WASM](#decoder_failed-or-offline-wasm)
- [Camera problems](#camera-problems)
- [Limits: WIRE_TOO_LARGE, INPUT_TOO_LARGE, DECODED_TOO_LARGE](#limits-wire_too_large-input_too_large-decoded_too_large)
- [WRONG_PASSPHRASE](#wrong_passphrase)
- [CSP blocks the canvas or WASM](#csp-blocks-the-canvas-or-wasm)
- [React 18/19](#react-1819)
- [Canvas sizing and blur](#canvas-sizing-and-blur)
- [UNSUPPORTED_RUNTIME](#unsupported_runtime)

## DECODER_FAILED or offline WASM

`createZXingDecoder` throws `DecoderError` (`DECODER_FAILED`) with the message
"the ZXing wasm module could not be prepared" when the asset cannot be fetched
or compiled. A missing or empty `wasmUrl` is a different failure:
`INVALID_ARGUMENT` with recovery `none`.

The offline failure is easy to misread. The app loads from cache, the camera
never opens, and `start()` records `DECODER_FAILED`. The cause is the WASM
asset, not the camera.

Check, in this order:

1. **Is `wasmUrl` a URL on your origin?**

   ```ts
   import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
   import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';

   const createDecoder = () => createZXingDecoder({ wasmUrl });
   ```

   There is no CDN fallback. A hardcoded `/assets/zxing_reader.wasm` only works
   if your build actually emits that file.

2. **Did the build emit it?** Search the output directory:

   ```bash
   find dist -name 'zxing_reader*.wasm'
   ```

   In the Network tab it must be a `200` from your origin, not a third-party
   host. A bundler error naming `zxing-wasm` means the optional peer is not
   installed.

3. **Is it precached?** `vite-plugin-pwa` skips a `.wasm` from `node_modules`
   unless `globPatterns` includes it:

   ```ts
   VitePWA({
     workbox: {
       globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
       maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
     },
   });
   ```

   Then prove it in the built service worker:

   ```bash
   grep -o 'zxing_reader[^"]*' dist/sw.js
   ```

   The decoder is roughly 925 KB. Workbox's 2 MiB default fits it today, but
   raise `maximumFileSizeToCacheInBytes` if your build or a future decoder grows.

4. **Did you install once while online?** A service worker only controls the
   origin after one successful visit. Load the app once over HTTPS (or
   `localhost`), install it, then test in airplane mode.

5. **Is the CSP blocking compilation?** See [CSP](#csp-blocks-the-canvas-or-wasm).

If the camera preview works but no frames are accepted, the decoder is failing
per frame. After 60 consecutive failures the camera reports `DECODER_FAILED`.
That usually means the same WASM problem, a decoder that is not the ZXing
adapter, or a camera too blurry to read any code. The receiver's diagnostics
panel shows the active resolution and focus capabilities.

## Camera problems

`getUserMedia` requires a **secure context**: HTTPS, `localhost`, or
`127.0.0.1`. A plain-HTTP LAN address is not one, even on the same Wi-Fi. Check
`window.isSecureContext` first; no amount of permission UI fixes an insecure
origin.

| Code | What it means | What to do |
| --- | --- | --- |
| `CAMERA_PERMISSION_DENIED` | The user (or policy) refused. | Offer a retry; the user must allow it in site settings. On iOS, check Settings → Safari → Camera. |
| `CAMERA_NOT_FOUND` | No video input was reported. | Check the device; a desktop may have no camera. |
| `CAMERA_IN_USE` | Another app or tab holds the camera. | Close the other app/tab. iOS allows one active camera stream per app. |
| `CAMERA_UNAVAILABLE` | Opening or setup failed for another reason. | Stop and start again; check `error.cause` for the original `DOMException`. |
| `CAMERA_CONSTRAINTS_FAILED` | The requested constraints were refused. | Remove strict `videoConstraints`; use `cycle()`/`select()` instead. |
| `TORCH_UNSUPPORTED` | The active track has no torch capability. | Hide the control. The packaged receiver does this automatically. |

A failed `start()` does **not** reject; it records `error`. Handle the state:

```tsx
const { error, start } = useCameraReader({ createDecoder });

if (error?.recovery === 'grant-permission') {
  return <p>Allow camera access, then retry.</p>;
}
```

A short camera list is usually the browser, not the library. Until permission is
granted, `enumerateDevices()` may return blank labels. Some Android builds only
reveal secondary rear cameras after a stream has been opened. Call `rescan()`;
the receiver's diagnostics table shows exactly what the browser reported.

If the preview stays black but the track is live, confirm the video has
`playsInline` and `muted`, and that `videoRef` is attached. On iOS a component
that unmounts and remounts during a camera open can race the stream; the hook's
generation guard releases the late stream, but the preview needs the new element.

## Limits: WIRE_TOO_LARGE, INPUT_TOO_LARGE, DECODED_TOO_LARGE

All three are `PayloadTooLargeError` subclasses with `scope`, `actual`, and
`limit` fields. Limits only tighten; a limit above the ceiling is
`INVALID_ARGUMENT`.

| Code | Scope | Meaning |
| --- | --- | --- |
| `INPUT_TOO_LARGE` | `input` | Raw bytes exceed `maxInputBytes` (default 8 MiB). This check runs before compression. |
| `WIRE_TOO_LARGE` | `wire` | The compressed body exceeds `maxWireBytes` (default 1 MiB). This is the transfer budget. |
| `DECODED_TOO_LARGE` | `decoded` | Decompressed output exceeds `maxDecodedBytes` (default 8 MiB), or the sender declared a plaintext larger than the reader's limit. |

`WIRE_TOO_LARGE` is the common one. A 1.2 MiB already-compressed file (ZIP, JPEG,
PNG, video) cannot shrink, so it cannot fit a 1 MiB wire. JSON usually
compresses 3–8×, so an 8 MiB document often fits. The writer rejects the wire
size **before** hashing or PBKDF2, so the error arrives quickly.

Options:

- Split the file, or send a smaller representation.
- Lower `maxInputBytes`/`maxWireBytes` to fail earlier in your own UI.
- Do not try to raise the ceiling past 1 MiB: it is part of the protocol, not a
  preference.

A reader can be stricter than the sender; `limits: { maxWireBytes }` on
`createQrStreamReader` rejects a stream whose declared `k × blockSize` cannot
fit. `DECODED_TOO_LARGE` during `result()` is the gzip-bomb guard: the
decompressor is cancelled at the cap instead of buffering the expansion.

For mixed 0.2/1.0 devices, the 0.2 receiver only accepts plaintext up to 1 MiB.
Set `limits: { maxInputBytes: 1024 * 1024 }` on the sender, or update both
devices. See
[Limits and version compatibility](integration.md#5-limits-and-version-compatibility).

## WRONG_PASSPHRASE

`WrongKeyError` (`WRONG_PASSPHRASE`, recovery `retry-passphrase`) means AES-GCM
authentication failed. It cannot distinguish a mistyped passphrase from a
damaged payload; both produce the same failure.

The reader keeps the assembled ciphertext, so do **not** rescan:

```ts
try {
  const result = await reader.result(nextPassphrase);
} catch (cause) {
  if (isQrStreamError(cause) && cause.code === 'WRONG_PASSPHRASE') {
    // Ask again with the same reader.
  }
}
```

React exposes `wrongKey` and `retryKey(next)`; `QrStreamReceiver` renders the
unlock field for you. If every retry fails, restart the transfer rather than
rescanning forever. The passphrase is Unicode NFKC-normalized and trimmed on
both ends, so stray leading/trailing spaces and full-width characters do not
matter; case and spelling do.

Encryption protects against a bystander recording the screen. It does not make a
weak passphrase strong: a short spoken phrase can be cracked offline. Use six
random words or a generated passphrase.

## CSP blocks the canvas or WASM

A strict `script-src` blocks WebAssembly compilation. Add
`'wasm-unsafe-eval'` (not the broader `'unsafe-eval'`). The demo's policy is:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
Permissions-Policy: camera=(self)
```

Why each part matters:

- `script-src 'wasm-unsafe-eval'` — WebAssembly compilation.
- `style-src 'unsafe-inline'` — the packaged React components inject one
  `<style>` element. A nonce/hash host can supply its own instead.
- `img-src data: blob:` — canvas/download surfaces; the QR canvas itself does
  not need it, but host previews often do.
- `worker-src 'self'` — if your bundler or decoder runs the WASM in a worker.
- `camera=(self)` — the embedded preview is allowed to request the camera.

If the browser console says "Refused to compile or instantiate WebAssembly
module", the CSP is the cause even though the asset returned 200.

## React 18/19

Both versions are supported. `videoRef` is typed as `QrVideoRef`, a plain
`{ current: HTMLVideoElement | null }` assignable to both React 18 and React 19
refs without a cast:

```tsx
const { videoRef } = useCameraReader({ createDecoder });
return <video ref={videoRef} autoPlay playsInline muted />;
```

If TypeScript complains about the ref, you are probably on a 0.2 type. Upgrade
the package; do not add `as unknown as RefObject<...>`.

`useCameraReader` is safe under StrictMode: its cleanup stops the camera and
invalidates an in-flight open. If you see two camera starts in development, the
first is StrictMode's deliberate mount/unmount and its stream is released; check
`starting`/`ready` rather than counting effect calls.

Importing `@orozcoh/qr-stream/react` in Node is safe for SSR: style injection is
deferred until a document exists. The hooks still need a browser to open a
camera, so render the receiver only on the client (or behind a mount check).

## Canvas sizing and blur

The renderer sizes the canvas to an **integer** module scale. Fractional scaling
is what produces the moire that makes dense codes unreadable, so it measures the
parent element and snaps **down** to a whole multiple of the module grid.

Common mistakes:

- **CSS stretches the canvas.** `canvas { width: 100% }` after `play()` feeds a
  fractional size back in. Give the canvas a fixed-size parent instead:

  ```html
  <div style="width: min(70vw, 420px); aspect-ratio: 1">
    <canvas></canvas>
  </div>
  ```

- **The parent has no width.** The renderer falls back to the canvas's own
  `clientWidth`, then to one pixel per module. The result may be tiny. Give the
  stage an explicit width.
- **The parent resizes while streaming.** Every frame re-measures; a responsive
  layout that changes width mid-transfer can change scale and blur frames.
- **`size` is not exact.** `size` is a target CSS width; the painted result
  snaps down to an integer module scale and may be slightly smaller.
- **A blank canvas.** `renderQrStream` throws `RENDER_FAILED` if a 2D context is
  unavailable. If the canvas is blank but the controller exists, check that
  `play()` was called and that the writer/packets are not exhausted.

High-DPI devices multiply the CSS width by `devicePixelRatio` before snapping.
That is intentional: it gives the camera more pixels per module. Do not set a
matching CSS width yourself; `size` already pins it.

## UNSUPPORTED_RUNTIME

The core needs `CompressionStream`, `DecompressionStream`, and `crypto.subtle`.
One missing produces `UNSUPPORTED_RUNTIME` with recovery `upgrade-browser`. This
is a runtime capability check, not a version check: an embedded WebView or an
old browser can fail it while a current desktop browser works.

A secure context is required for `crypto.subtle` in some browsers and for
`getUserMedia` in all of them. Load over HTTPS or `localhost`.
