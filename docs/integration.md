# Host, PWA, and headless integration

This guide is for the host application: the thing that renders a sender, opens a
camera, precaches an offline app, or drives the codec without React. It assumes
the package is installed:

```bash
npm install @orozcoh/qr-stream
```

The core is DOM-free and runs in Node. The browser and React entries need a DOM;
the decoder needs `zxing-wasm`, installed separately.

## 1. Choose an entry point

| Import | What it gives you | DOM |
|---|---|---|
| `@orozcoh/qr-stream` | Writer, reader, packet codec, crypto, errors, limits. | No |
| `@orozcoh/qr-stream/browser` | `renderQrStream`, `readQrStream`, camera controller. | Yes |
| `@orozcoh/qr-stream/qr` | `packetToMatrix`, `qrCapacity`, `matrixToRGBA`. | No canvas |
| `@orozcoh/qr-stream/react` | `QrStreamSender`, `QrStreamReceiver`, hooks, `ErrorText`, strings. | Yes |
| `@orozcoh/qr-stream/browser/zxing` | `createZXingDecoder`. | Yes |

A minimal headless sender and receiver:

```ts
import { createQrStreamWriter, createQrStreamReader } from '@orozcoh/qr-stream';
import { renderQrStream, readQrStream } from '@orozcoh/qr-stream/browser';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';
```

Use the **hooks** when you want your own layout, copy, or controls. Use the
**packaged components** for a quick embed: they paint their own background,
centre themselves, inject their styles once, and carry no page-level
assumptions. Neither is a wrapper around the other; both sit on the same core.

## 2. Sender

`createQrStreamWriter` prepares the payload. `renderQrStream` animates it.

```ts
import { createQrStreamWriter } from '@orozcoh/qr-stream';
import { renderQrStream } from '@orozcoh/qr-stream/browser';

const writer = await createQrStreamWriter(bytes, {
  filename: 'report.json',
  preset: 'balanced', // 'fast' | 'balanced' | 'dense' | 'extreme'
  // passphrase: 'spoken aloud', // omit for a clear transfer
});

const canvas = document.querySelector('canvas')!;
const controller = renderQrStream({
  writer,
  canvas,
  fps: 12, // optional; defaults to the preset's rate
});

controller.play();

// Later, when the human stops the transfer:
controller.stop();
```

### The writer owns the QR version

`writer.version` is the QR version encoded into every packet, and `writer.preset`
is the preset that produced it. Pass the writer, not a separately chosen version:

```ts
renderQrStream({ writer, canvas });
```

Renderer mode requires either `{ writer }` or `{ packets, version }`, never both.
Writer mode reads `writer.version` and defaults `fps` to `writer.preset`'s rate,
so the two cannot disagree. **Never hardcode a preset version** — the table is an
implementation detail, and a hardcoded version paired with a writer's packets
produces frames the receiver cannot read.

For a packet source you generate yourself, the low-level form still exists:

```ts
renderQrStream({ packets: myPackets, version: 25, fps: 10, canvas });
```

### Fixed-size stage

The canvas is sized to an **integer** module scale on every frame. Fractional
scaling is what produces the moire that makes dense codes unreadable, so the
renderer measures the parent element and snaps **down** to a whole multiple of
the module grid. Give the canvas a parent that does not resize while streaming:

```html
<div class="stage" style="width: min(70vw, 420px); aspect-ratio: 1">
  <canvas></canvas>
</div>
```

`size` overrides the parent measurement with a target CSS width in pixels:

```ts
renderQrStream({ writer, canvas, size: 420 });
```

It still snaps down to an integer module scale, so the painted result may be
slightly smaller than `size`. There is a floor: below one CSS pixel per module
the canvas cannot shrink further, so a very small `size` renders at one device
pixel per module and may come out larger than requested.

### `stop()` clears the last frame

`RenderController.stop()` cancels the animation, releases the packet iterator,
and **clears the canvas**. A stopped controller must not leave a scannable frame
on screen — with `k === 1`, the last frame carries the whole file. `pause()` is
different: it freezes the current frame for inspection. Call `stop()` on
unmount, and when the host switches files, density, or passphrase.

## 3. Receiver and camera lifecycle

The camera path is two pieces: a decoder factory you own, and a controller that
reads frames.

```tsx
import { useCameraReader } from '@orozcoh/qr-stream/react';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';

// Define this once, at module scope or in a useCallback.
const createDecoder = () => createZXingDecoder({ wasmUrl: '/assets/zxing_reader.wasm' });

function Scanner() {
  const { videoRef, start, stop, error } = useCameraReader({
    createDecoder,
    enabled: true,
  });

  if (error?.recovery === 'grant-permission') return <p>Allow camera access.</p>;

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted />
      <button type="button" onClick={() => void start()}>Start</button>
      <button type="button" onClick={stop}>Stop</button>
    </>
  );
}
```

`createDecoder` is a factory because the hook calls it every time it opens the
camera — a modal closes and reopens, the device switches, or the host calls
`start()` again. Keep the factory's identity stable anyway: the hook reads it
through a ref, so a new function does not restart a live camera, but defining it
once keeps the call site predictable.

### `enabled`, `start()`, and `stop()`

- `enabled` defaults to `true`: the camera opens on mount and closes when it
  turns `false`.
- `enabled: false` is for a preview that should not open until the user asks.
  Manual `start()` still works while `enabled` is false — the host is driving
  the lifecycle.
- `start()` opens the camera if it is not already starting or open. It is safe
  to call repeatedly.
- `stop()` releases the camera, disposes the decoder, and keeps the last device
  list so a restart is fast.
- Unmounting the component also stops the camera, including an open that is
  still waiting for the decoder to load.

For a modal using the hook, pass `enabled: isOpen`. The packaged
`QrStreamReceiver` has no `enabled` prop: mount it only while the dialog is
open, and unmounting stops the camera.

### Typed errors and recovery

`error` is a `QrStreamError | null`, never a string. Branch on `error.code`, and
use `error.recovery` to decide what to offer:

```tsx
function CameraStatus() {
  const { error, start, cycle } = useCameraReader({ createDecoder });

  if (!error) return null;
  switch (error.recovery) {
    case 'grant-permission':
      return <p>Allow camera access, then try again.</p>;
    case 'change-camera':
      return <button type="button" onClick={() => void cycle()}>Try another camera</button>;
    case 'retry':
      return <button type="button" onClick={() => void start()}>Retry</button>;
    case 'retry-passphrase':
      return <p>Check the passphrase — no need to rescan.</p>;
    default:
      return <p>{error.message}</p>;
  }
}
```

`isQrStreamError(value)` narrows an unknown caught value to the library's error
type. A rejected `start()` also records the same object on `error`, so handle it
once rather than once per path.

The hook also exposes `torchSupported`, `torch`, and `setTorch(on)`.
`setTorch` rejects with `TORCH_UNSUPPORTED` when the track has no torch
capability; the component only renders the button when `torchSupported` is true.

### React 18 and React 19

`videoRef` is a plain `{ current: HTMLVideoElement | null }` object, structurally
assignable to both React 18's `RefObject<HTMLVideoElement>` and React 19's
`RefObject<HTMLVideoElement | null>`. It works without a cast:

```tsx
const { videoRef } = useCameraReader({ createDecoder });
return <video ref={videoRef} autoPlay playsInline muted />;
```

The React entry supports React 18 and 19. The hook uses an object ref (not a
callback ref) and its own generation guard, so the same open/stop lifecycle
works on both versions.

### Headless camera

Without React, `readQrStream` is the same controller:

```ts
import { readQrStream } from '@orozcoh/qr-stream/browser';

const controller = await readQrStream({ video, decode });
controller.onSymbol((bytes) => reader.add(bytes));
controller.onError((error) => show(error.code, error.recovery));
```

`decode` is required. There is deliberately no default decoder: a built-in one
would put roughly 925 KB of WASM into every project that imports
`@orozcoh/qr-stream/browser`.

## 4. Offline PWA checklist

The failure this section prevents is silent: the app loads from cache, the
camera opens, and every frame fails to decode because the WASM was never
precached. Online it looks fine. In the airgap it never completes a transfer.

### Secure context

`getUserMedia` requires a secure context. Serve the app over **HTTPS** or on
`localhost`/`127.0.0.1`. A plain-HTTP LAN address is not a secure context, even
on the same Wi-Fi.

### Copy `zxing_reader.wasm` into your origin

Import the WASM through your bundler so it is emitted as an asset on your own
origin, then pass that URL as `wasmUrl`:

```ts
import zxingUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';

export const createDecoder = () => createZXingDecoder({ wasmUrl: zxingUrl });
```

`wasmUrl` is **required**. `createZXingDecoder` throws `INVALID_ARGUMENT` with
recovery `none` when it is missing or empty. This library does not use
`zxing-wasm`'s implicit CDN fallback: that fallback works online and fails in the
airgap, which is exactly where the app is supposed to work. If you hardcode a
path instead of using `?url`, make sure your host actually serves the file from
your origin.

### Workbox: precache the WASM

`vite-plugin-pwa` does not include a `.wasm` that came from `node_modules`
unless `globPatterns` says so. The demo uses:

```ts
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
  },
});
```

`maximumFileSizeToCacheInBytes` must be at least as large as the largest asset
you precache. The decoder is roughly 925 KB today, so Workbox's 2 MiB default is
enough for it; raise the ceiling if your build or a future decoder grows past
that. The demo uses 8 MiB.

### CSP: allow the WASM runtime

A strict `script-src` blocks WebAssembly compilation. Add `'wasm-unsafe-eval'`
(not the broader `'unsafe-eval'`):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'
```

The demo's full policy also allows inline styles and `blob:`/`data:` images for
the canvas and download link. Keep `camera=(self)` in `Permissions-Policy` so
the embedded preview is allowed to ask for the camera.

### Verify the built service worker

A successful build is not proof. Search the generated `sw.js` for the decoder
filename:

```bash
grep -o 'zxing_reader[^"]*' demo/dist/sw.js
```

You should see the hashed asset (for example `zxing_reader-abc123.wasm`). If the
search is empty, the glob is wrong and the receiver will fail offline. The demo
pins the glob and CSP in `tests/pwa-config.test.ts`; the built-`sw.js` search is
the runtime proof.

### No CDN fallback

There is no online fallback to hide a missing asset. The decoder either loads
from the `wasmUrl` you passed or the transfer does not work. That is deliberate:
a fallback turns a build error into a field failure.

## 5. Limits and version compatibility

Three budgets, three purposes:

| Constant | Value | What it bounds |
|---|---|---|
| `MAX_WIRE_BYTES` | 1 MiB (1,048,576) | Compressed body **before** encryption. |
| `MAX_INPUT_BYTES` | 8 MiB | Raw input, before compression. |
| `MAX_DECODED_BYTES` | 8 MiB | Decompressed output a reader will materialise. |

The wire budget is the transfer budget. Compression happens first, so raw size
and wire size are independent: an 8 MiB document fits only when it compresses
below 1 MiB (about 8×), while a 2 MiB document fits at 2×. What never fits is
incompressible data above 1 MiB.

The writer reports all three sizes:

```ts
writer.plainBytes; // original input bytes
writer.wireBytes; // compressed body before encryption; equals writer.meta.wireLen
writer.payloadBytes; // varint + metadata + wire body (and the GCM tag when encrypted)
```

### Limits only tighten

`maxWireBytes` and `maxInputBytes` are writer budgets; `maxWireBytes` and
`maxDecodedBytes` are reader budgets. A limit may only **tighten** the library
default. Values that are not positive integers at or below the hard ceiling are
rejected with `INVALID_ARGUMENT` and `details: { name, value, ceiling }`.

```ts
const writer = await createQrStreamWriter(bytes, {
  filename: 'report.json',
  preset: 'balanced',
  limits: { maxWireBytes: 256 * 1024, maxInputBytes: 512 * 1024 },
});
```

Reader limits are initial configuration for one reader instance; they are not a
per-frame setting.

### 0.2 compatibility

The wire format did not change in 0.3. A 0.3 stream is readable by a 0.2
receiver when the plaintext is **at most 1 MiB**, because the compressed body is
then at most 1 MiB and the decoded result stays under 0.2's cap. A 0.3 sender
can accept up to 8 MiB of raw input as long as the compressed wire fits; a 0.2
receiver rejects a decoded result over 1 MiB.

For a mixed-version deployment, opt down to the 0.2 input cap so every transfer
you produce stays readable by the older device:

```ts
const writer = await createQrStreamWriter(bytes, {
  filename: 'report.json',
  preset: 'balanced',
  limits: { maxInputBytes: 1024 * 1024 },
});
```

The React sender takes the same budgets as a prop:

```tsx
<QrStreamSender limits={{ maxInputBytes: 1024 * 1024 }} />
```

Encrypted streams are unaffected by the limit change, but they are still not
wire-compatible with `0.1.x` because of the metadata AAD added in `0.2.0`.

## 6. Error handling

Every branchable failure carries a `QrStreamErrorCode` and a
`QrStreamRecovery`. Messages are human-readable and may change; `code` and
`recovery` are the stable API.

| Code | Meaning | Default `recovery` |
|---|---|---|
| `INPUT_TOO_LARGE` | Raw input over `maxInputBytes`. | `change-input` |
| `WIRE_TOO_LARGE` | Compressed body over `maxWireBytes`. | `change-input` |
| `DECODED_TOO_LARGE` | Decompressed result over `maxDecodedBytes`. | `none` |
| `UNSUPPORTED_RUNTIME` | `CompressionStream`, `DecompressionStream`, or Web Crypto is missing. | `upgrade-browser` |
| `INVALID_ARGUMENT` | Bad limit, size, colour, or render mode. | `none` |
| `INVALID_QR_VERSION` | QR version out of range or encoder mismatch. | `none` |
| `INVALID_SCALE` | Raster scale is not a positive integer. | `none` |
| `PACKET_TOO_LARGE` | Packet does not fit the declared QR version. | `none` |
| `INVALID_PACKET` | Reserved for a malformed frame; `reader.add` returns `'invalid'` instead. | `none` |
| `INVALID_METADATA` | Truncated or inconsistent metadata block. | `rescan` |
| `UNSUPPORTED_VERSION` | Metadata version newer than this library. | `upgrade-library` |
| `COMPRESSION_FAILED` | gzip failed. | `retry` |
| `DECOMPRESSION_FAILED` | gunzip failed. | `rescan` |
| `CRYPTO_FAILED` | A Web Crypto operation failed. | `retry` |
| `WRONG_PASSPHRASE` | AES-GCM authentication failed. | `retry-passphrase` |
| `PAYLOAD_CORRUPT` | Length or SHA-256 mismatch after decoding. | `rescan` |
| `CAMERA_PERMISSION_DENIED` | Camera permission was refused. | `grant-permission` |
| `CAMERA_NOT_FOUND` | No camera on this device. | `change-camera` |
| `CAMERA_IN_USE` | Another app holds the camera. | `change-camera` |
| `CAMERA_UNAVAILABLE` | The camera could not be opened. | `change-camera` |
| `CAMERA_CONSTRAINTS_FAILED` | The camera refused the requested constraints. | `change-camera` |
| `TORCH_UNSUPPORTED` | The active track has no torch capability. | `none` |
| `DECODER_FAILED` | Decoder construction or frame decoding failed. | `retry` |
| `RENDER_FAILED` | A 2D canvas context was unavailable. | `none` |

The full recovery set is `retry`, `retry-passphrase`, `rescan`, `change-input`,
`change-camera`, `grant-permission`, `upgrade-browser`, `upgrade-library`, and
`none`.

```ts
import { isQrStreamError } from '@orozcoh/qr-stream';

try {
  await something();
} catch (cause) {
  if (isQrStreamError(cause)) {
    report(cause.code, cause.recovery, cause.details);
  } else {
    throw cause;
  }
}
```

`isQrStreamError` is an `instanceof` check. If your build can load two copies of
this package (a duplicated dependency), narrow on the presence of `code` and
`recovery` instead.

### Wrong key: retry without rescanning

`reader.result(passphrase)` throws `WrongKeyError` with code `WRONG_PASSPHRASE`
when AES-GCM authentication fails — a mistyped passphrase, or a damaged
payload. The reader keeps the assembled ciphertext, so a retry costs a retype,
not another scan:

```ts
try {
  const result = await reader.result(passphrase);
  // ...
} catch (cause) {
  if (isQrStreamError(cause) && cause.code === 'WRONG_PASSPHRASE') {
    // Ask for the passphrase again; keep the same reader.
  }
}
```

In React, `useQrStreamReader` exposes `wrongKey` and `retryKey(nextPassphrase)`:

```tsx
import { useState } from 'react';
import { useQrStreamReader } from '@orozcoh/qr-stream/react';

function Unlock({ passphrase }: { passphrase?: string }) {
  const { wrongKey, retryKey } = useQrStreamReader({ passphrase });
  const [typed, setTyped] = useState('');

  if (!wrongKey) return null;
  return (
    <>
      <input type="password" value={typed} onChange={(event) => setTyped(event.target.value)} />
      <button type="button" onClick={() => void retryKey(typed)}>Unlock</button>
    </>
  );
}
```

`QrStreamReceiver` renders this flow for you. The packaged copy says "try again
— no need to rescan" so the human does not walk back to the sender.

### `formatError` and `ErrorText`

Hosts translate errors with `formatError`, which receives the typed error and
returns the string to display:

```tsx
<QrStreamReceiver
  decoder={createDecoder}
  formatError={(error) => t(`error.${error.code}`)}
/>
```

`ErrorText` renders the one error surface for the packaged components with
`role="alert"`, so camera, decoder, writer, and reader failures are all
announced the same way. `defaultFormatError` is the default: the error's own
message.

## 7. Styling and i18n

### Styling

The packaged components inject their styles once. Every rule sits inside
`:where()`, so it has **zero specificity**: a host's plain class or tag selector
wins without `!important`. Colours and dimensions are `--qrs-*` custom
properties on `.qrs`:

```css
.qrs {
  --qrs-bg: #0b1120;
  --qrs-surface: #1e293b;
  --qrs-fg: #f8fafc;
  --qrs-muted: #94a3b8;
  --qrs-border: #334155;
  --qrs-accent: #6366f1;
  --qrs-on-accent: #ffffff;
  --qrs-danger: #f87171;
  --qrs-radius: 12px;
  --qrs-width: 360px;
  --qrs-font: ui-sans-serif, system-ui, sans-serif;
}
```

Set a variable on any ancestor; it inherits into the component. Do not fight
the canvas with a CSS width or height — the renderer sizes it to an integer
module scale, and stretching it reintroduces fractional scaling.

For a custom sender, pass `size` and `colors` to the renderer (or to
`matrixToRGBA`):

```ts
renderQrStream({
  writer,
  canvas,
  size: 420,
  colors: {
    quietZone: 4,
    dark: [15, 23, 42, 255],
    light: [248, 250, 252, 255],
  },
});
```

Colours are `[red, green, blue, alpha]` tuples of integers from 0 to 255. Dark
modules must be darker than light ones; an inverted code is not guaranteed to
decode. The quiet zone is in modules and must be a non-negative integer.
Defaults are opaque black on white, with a 4-module quiet zone.

### Copy and placeholders

Every visible string in `QrStreamSender` and `QrStreamReceiver` comes from
`QrStreamStrings`, so a host translates the whole UI with one prop:

```tsx
<QrStreamSender
  strings={{
    start: 'Iniciar transmisión',
    stop: 'Detener',
    progress: '{solved} / {k} bloques · {percent}% · {rate} fotogramas/s',
  }}
/>
```

Defaults are in `DEFAULT_QR_STREAM_STRINGS`. `strings` is
`Partial<QrStreamStrings>`; an omitted key keeps its default, and `undefined`
does not blank a default out.

Templates use `{placeholder}` placeholders resolved by `formatQrString`. A value
is substituted verbatim — `$&` and `$1` are not treated as replacement
patterns — and an unknown placeholder stays visible, so a missing translation
shows up in the UI instead of silently swallowing the word.

The sender uses `{fps}`, `{estimate}`, `{types}`, `{name}`, `{kb}`, `{limit}`,
and `{version}`. The receiver uses `{solved}`, `{k}`, `{percent}`, `{rate}`,
`{filename}`, `{count}`, `{value}`, `{label}`, `{width}`, `{height}`, `{fps}`,
and `{focus}`. The estimate already carries its `~` prefix; it is a formatted
value, not a label.

`formatError` is the template for errors: it receives the typed error, so a host
can map `error.code` to a translated sentence without matching on English
messages.

## 8. Testing on two devices

Do this with the real devices, over the network path the users will have.

1. **Secure context.** Deploy over HTTPS, or serve on `localhost`. A plain-HTTP
   LAN URL has no camera access.
2. **Plain transfer.** Send a small JSON file. Confirm the receiver reaches
   `{solved} / {k}` complete, verifies the SHA-256, and saves the same bytes.
3. **Encrypted transfer.** Repeat with a passphrase spoken aloud and typed on
   both devices. Then type it wrong on purpose: the receiver must offer the
   unlock flow and recover **without rescanning** (`WRONG_PASSPHRASE`).
4. **More than 1 MiB, compressible.** Send a JSON document over 1 MiB with
   repeated records. It must be accepted (raw input up to 8 MiB) because the
   compressed wire stays under 1 MiB, and it must round-trip byte-for-byte.
5. **The wire boundary, incompressible.** A 1 MiB incompressible file is
   exactly at the wire cap and must be accepted; 1 MiB + 1 byte must be rejected
   with `WIRE_TOO_LARGE` and `recovery: 'change-input'` instead of starting a
   transfer that cannot finish. If the larger file is accepted, the budget is
   not wired through.
6. **Stop and start.** Stop the sender: the last frame must disappear (not
   remain scannable). Stop the receiver: the camera light must go out. Start
   both again and finish a transfer.
7. **Torch.** If the device offers `torchSupported`, toggle it over a dark
   surface and confirm the preview brightens. If it does not, the control must
   not appear.
8. **Offline PWA.** Install the app on each device once while online. Then turn
   networking off (airplane mode, not just Wi-Fi), relaunch from the home
   screen, and complete a transfer. This is the only check that proves the
   `zxing_reader.wasm` asset was precached; see
   [Offline PWA checklist](#4-offline-pwa-checklist).

Repeat the plain and encrypted cases on both browsers you intend to support.
Dense presets are the ones most likely to expose a focus or scaling problem, so
run at least one pass at `dense` or `extreme` on the older phone.
