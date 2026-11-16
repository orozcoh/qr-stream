# Migrating from 0.2 to 1.0

The **wire format did not change**. A 1.0 build reads every legal 0.2 stream, and a
0.2 receiver can read a 1.0 stream when the plaintext is at most 1 MiB (or when
the sender opts down with `limits: { maxInputBytes: 1024 * 1024 }`).

**RC status:** this guide targets `1.0.0-rc.1`, which will be published under
the `next` dist-tag (publication pending); `latest` stays on `0.2.0` until the
final `1.0.0` publish.

The **API did change**. There are no aliases, deprecation shims, or dual error
surfaces: 0.2 called the old names, 1.0 calls the new ones. This page is the
complete list of things a 0.2 host has to touch. The current package version and
its compatibility row are in the [README](../README.md#version-compatibility).

- [Errors: one typed surface](#errors-one-typed-surface)
- [Low-level helpers are internal](#low-level-helpers-are-internal)
- [Limits: 8 MiB raw, 1 MiB wire, 8 MiB decoded](#limits-8-mib-raw-1-mib-wire-8-mib-decoded)
- [Sender: `renderQrStream({ writer })`](#sender-renderqrstream-writer-)
- [Camera: `start`/`stop`/`enabled` and typed errors](#camera-startstopenabled-and-typed-errors)
- [Strings and `formatError`](#strings-and-formaterror)
- [Colors and `size`](#colors-and-size)
- [The decoder now requires `wasmUrl`](#the-decoder-now-requires-wasmurl)
- [`WrongKeyError` moved](#wrongkeyerror-moved)
- [Migration checklist](#migration-checklist)

## Errors: one typed surface

0.2 reported failures as plain values, and the three hooks did not agree:

| 0.2 hook | `error` type |
| --- | --- |
| `useQrStreamReader` | `string \| null` |
| `useCameraReader` | `string \| null` |
| `useQrStreamWriter` | `Error \| null` |

1.0 exposes exactly one value on every hook:

```ts
error: QrStreamError | null
```

Render `error.message`, and branch on `error.code` and `error.recovery` (messages
are human-readable and non-contractual). The old string comparisons against
English text have to go:

```tsx
// 0.2
if (error === 'That passphrase does not match. Try again — no need to rescan.') {
  showUnlock();
}
if (error) return <p>{error}</p>;

// 1.0
if (error?.code === 'WRONG_PASSPHRASE') showUnlock();
if (error) return <p>{error.message}</p>;
```

The writer hook's `Error | null` becomes `QrStreamError | null`; `error.message`
still displays, but `error.code` now tells `WIRE_TOO_LARGE` apart from an
unrelated failure.

`isQrStreamError(value)` narrows an unknown caught value. The subclasses are
`PayloadTooLargeError`, `WrongKeyError`, `CameraError`, `DecoderError`, and
`RenderError`; all extend `QrStreamError` and keep `code`, `recovery`, and the
optional `cause`.

```ts
import { isQrStreamError } from '@orozcoh/qr-stream';

try {
  await start();
} catch (cause) {
  if (isQrStreamError(cause)) report(cause.code, cause.recovery);
  else throw cause;
}
```

Some 0.2 core failures were `RangeError` (QR capacity, the decompression cap,
and metadata/varint parsing). 1.0 maps those to typed codes. Replace
`instanceof RangeError` with `isQrStreamError(cause)` plus a code check.

## Low-level helpers are internal

The package root exports the transfer surface: presets, limits, the typed
errors, `gzipIfSmaller`/`gunzip`, `StreamMeta`, and the writer/reader factories.
Everything underneath is internal: CRC-32, packet encode/decode, fountain
symbols, the deterministic PRNG, metadata and varint codecs, the AES-GCM
helpers, and the framing constants. Those exports are marked `@internal`, are
absent from `etc/qr-stream.api.md`, and may change without a major version.

Use the writer, `renderQrStream({ writer })`, the reader, and the hooks instead
of driving the building blocks yourself. The one low-level sender form that
remains public is `renderQrStream({ packets, version })` from
`@orozcoh/qr-stream/browser`, for a packet source you generate yourself.

## Limits: 8 MiB raw, 1 MiB wire, 8 MiB decoded

0.2 treated `MAX_INPUT_BYTES` as a 1 MiB cap on everything. 1.0 has three
independent budgets:

| Constant | 1.0 value | What it bounds |
| --- | --- | --- |
| `MAX_WIRE_BYTES` | 1 MiB | Compressed body **before** encryption. This is the transfer budget. |
| `MAX_INPUT_BYTES` | 8 MiB | Raw input, before compression. |
| `MAX_DECODED_BYTES` | 8 MiB | Decompressed output a reader will materialise. |

A 2 MiB JSON document is now accepted when it compresses below 1 MiB. For
byte-for-byte 0.2 admission behavior, pass the old cap explicitly:

```ts
const writer = await createQrStreamWriter(bytes, {
  filename: 'report.json',
  preset: 'balanced',
  limits: { maxInputBytes: 1024 * 1024 },
});
```

The React sender takes the same object:

```tsx
<QrStreamSender limits={{ maxInputBytes: 1024 * 1024 }} />
```

`limits` may only **tighten** a default. A non-positive integer, a fraction, or a
value above the hard ceiling throws `INVALID_ARGUMENT` with
`details: { name, value, ceiling }`. Reader limits are initial configuration for
one reader instance; changing them on a later render does not rebuild an
in-progress reader.

The writer now reports the split instead of a single size:

```ts
writer.plainBytes; // original input
writer.wireBytes; // compressed body before encryption; equals meta.wireLen
writer.payloadBytes; // varint + metadata + wire body (and the GCM tag)
```

## Sender: `renderQrStream({ writer })`

0.2 required the caller to pass packets and a hardcoded version. That let the
two disagree. 1.0 binds the renderer to the writer:

```ts
// 0.2 shape
renderQrStream({ packets: writer.packets(), version: 25, fps: 12, canvas });

// 1.0
renderQrStream({ writer, canvas });
```

Writer mode reads `writer.version` and defaults `fps` to the preset's rate. Never
hardcode a preset version. The low-level form still exists for a packet source
you generate yourself:

```ts
renderQrStream({ packets: myPackets, version: 25, fps: 10, canvas });
```

Passing both `writer` and `packets` (or neither) throws `INVALID_ARGUMENT`.
`RenderController.stop()` still clears the last painted frame and releases the
iterator; keep calling it on unmount and when the file, density, or passphrase
changes.

## Camera: `start`/`stop`/`enabled` and typed errors

`useCameraReader` no longer relies on mount/unmount alone:

```ts
const { videoRef, start, stop, error, starting } = useCameraReader({
  createDecoder,
  enabled: isOpen, // default true
});
```

- `enabled` defaults to `true` and closes the camera when it turns `false`.
- `start()` opens the camera if it is not already starting or open.
- `stop()` releases the tracks, disposes the decoder, and keeps the last device
  list so a restart is fast.
- Unmounting also stops the camera, including an open still waiting for the
  decoder.
- `error` is a `QrStreamError | null`. A failed `start()` **records** the error;
  the promise resolves, so `try { await start() } catch` sees nothing.

The camera callback changed argument type, not arity. 0.2 was
`onError(callback: (error: string) => void)`; 1.0 is
`onError(callback: (error: QrStreamError) => void)`. It is still a one-argument
handler; only the parameter type changes:

```ts
// 0.2
controller.onError((message: string) => show(message));

// 1.0
controller.onError((error: QrStreamError) => show(error.code, error.recovery));
```

An unannotated parameter (`(error) => show(error)`) keeps compiling, but it now
receives an object. Read `error.message` to display text.

Camera mutations (`select`, `cycle`, `rescan`, `setZoom`, `applyConstraints`,
`setTorch`) reject with `CameraError`; the React hook catches them and surfaces
`error`, so UI handlers do not unhandled-reject. `readQrStream` setup failures
also reject a `CameraError`, with the original `DOMException` in `cause`.

## Strings and `formatError`

Every visible label in `QrStreamSender` and `QrStreamReceiver` now comes from one
prop. The defaults are English and unchanged.

```tsx
<QrStreamSender
  strings={{
    start: 'Iniciar transmisión',
    stop: 'Detener',
    speed: 'Velocidad — {fps} fps · {estimate} para recibir',
  }}
  formatError={(error) => t(`error.${error.code}`)}
/>
```

`strings` is `Partial<QrStreamStrings>`; an omitted key keeps its default, and an
explicit `undefined` does not blank one. Templates use `{placeholder}` and are
resolved by `formatQrString`. Unknown placeholders stay visible, so a missing
translation shows up in the UI instead of silently swallowing the word.

`formatError` receives the typed error. Its default is `defaultFormatError`, which
returns `error.message`. `ErrorText` renders the one error region with
`role="alert"`; hosts that build their own layout can use it directly.

## Colors and `size`

`matrixToRGBA(matrix, scale, quietZone)` still works. The object form adds colors:

```ts
import { matrixToRGBA } from '@orozcoh/qr-stream/qr';

const image = matrixToRGBA(matrix, 8, {
  quietZone: 4,
  dark: [15, 23, 42, 255],
  light: [248, 250, 252, 255],
});
```

`scale` remains an integer number of **pixels per module**, not a target size.
Channels must be integers 0–255; dark modules must be darker than light ones.
Defaults are pixel-identical to 0.2.

`renderQrStream` now accepts a target CSS width:

```ts
renderQrStream({ writer, canvas, size: 420 });
```

It still snaps down to an integer module scale, so the painted result may be
slightly smaller than `size`. Do not stretch the canvas with CSS afterwards;
that reintroduces the fractional scaling the renderer avoids.

## The decoder now requires `wasmUrl`

`createZXingDecoder({ wasmUrl })` is required. The implicit CDN fallback is gone:
it worked online and failed in the airgap, which is the one place this library
has to work.

```ts
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';

const createDecoder = () => createZXingDecoder({ wasmUrl });
```

A missing or empty `wasmUrl` throws `INVALID_ARGUMENT` with recovery `none`. Copy
the asset to your own origin through your bundler, precache it, and allow
`'wasm-unsafe-eval'` in CSP. See the
[offline PWA checklist](integration.md#4-offline-pwa-checklist) and
[troubleshooting](troubleshooting.md#decoder_failed-or-offline-wasm).

## `WrongKeyError` moved

`WrongKeyError` is still exported from `@orozcoh/qr-stream` and
`@orozcoh/qr-stream/react`; its source moved from `src/core/crypto.ts` to
`src/core/errors.ts`. If you imported it from the package root or `/react`,
nothing changes. If you reached into the old internal module
(`.../dist/core/crypto`), move the import to a public entry.

It still means "AES-GCM authentication failed": a wrong passphrase or a damaged
payload. The reader keeps the assembled ciphertext, so a retry costs a retype,
not another scan:

```ts
try {
  const result = await reader.result(passphrase);
} catch (cause) {
  if (isQrStreamError(cause) && cause.code === 'WRONG_PASSPHRASE') {
    // Ask again; keep the same reader.
  }
}
```

In React, `useQrStreamReader` exposes `wrongKey` and `retryKey(next)`.
`QrStreamReceiver` renders the same flow with an unlock field.

## Migration checklist

```bash
# A hit is a deep import of the old internal module; public imports from the
# package root or /react need no change.
rg "from ['\"].*/crypto(\.js)?['\"]" src

# Review these call sites: the low-level packet form still exists, but writer
# mode is the 1.0 sender; the decoder now requires wasmUrl; RangeError checks
# no longer catch domain errors.
rg "renderQrStream\(\{ packets|createZXingDecoder\(\{|instanceof RangeError" src
```

- [ ] Change every hook `error` from `string`/`Error` to `QrStreamError`; render
      `error.message` and branch on `error.code`/`error.recovery`.
- [ ] Update camera `onError` handlers from `(error: string)` to
      `(error: QrStreamError)`.
- [ ] Replace `instanceof RangeError` with `isQrStreamError` plus a code check.
- [ ] Replace imports of the packet, fountain, crypto, metadata, varint, PRNG,
      or CRC-32 helpers with the writer, reader, or hooks (they are internal).
- [ ] Decide whether to keep 8 MiB raw input or opt down with
      `limits: { maxInputBytes: 1024 * 1024 }`.
- [ ] Replace hardcoded packet/version senders with `renderQrStream({ writer })`.
- [ ] Adopt `enabled`/`start()`/`stop()` where the host needs manual camera
      control, and read the typed error instead of matching messages.
- [ ] Add `strings`/`formatError` if the host had forked the UI to translate it.
- [ ] Pass `wasmUrl` and precache the `.wasm` asset.
- [ ] Replace any deep `.../crypto` `WrongKeyError` import with the package root
      or `/react`.
- [ ] Re-run the two-device checks in the
      [integration guide](integration.md#8-testing-on-two-devices).
