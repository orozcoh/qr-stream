# qr-stream

Move a JSON file between two devices with **no network, no pairing, no NFC, no
Bluetooth**. One screen animates a sequence of QR codes; the other device's
camera reads them and rebuilds the file.

This is a library plus a demo PWA. The codec is DOM-free and runs in Node, so
the reliability claims below are proven by tests rather than by hoping.

- [Why it works](#why-it-works)
- [Install the demo](#install-the-demo)
- [Library API](#library-api)
- [React API](#react-api)
- [Offline requirements](#offline-requirements)
- [Wire format](docs/wire-format.md)

## Why it works

A sequential loop of QR codes has to land **every** frame: miss frame 7 because
of a specular highlight and the transfer never completes. Instead this uses a
**systematic Luby Transform fountain code**. The sender emits block 0, block 1,
… then endless XOR combinations. The receiver collects whatever it catches, in
any order, and finishes once it has enough independent symbols. Missing frames
are just erasures.

Consequences worth knowing:

- There is **no back channel**. The receiver cannot tell the sender anything.
  The sender loops forever; the human in the room decides when to stop it.
- The receiver shows an absolute rate (`frames/s`) rather than comparing to the
  sender, because both people are standing next to each other.
- Failing to finish is not a failure state — it means "keep pointing".

Payload limits: JSON only, **250 KiB**. Typical JSON compresses 3–8×, so the
common case transfers in a few seconds.

## Install the demo

```bash
pnpm install
pnpm build          # library: dist/
pnpm demo:build     # demo PWA: demo/dist/
pnpm demo:preview   # serve over http://localhost:4173
```

To use it across two real devices, deploy `demo/dist/` to any static host over
**HTTPS** (or serve it on `localhost`). That one visit is required: `getUserMedia`
needs a secure context, and the service worker has to cache the app before the
two devices are allowed to be offline.

## Library API

```ts
import { createQrStreamWriter, createQrStreamReader } from 'qr-stream';

const writer = await createQrStreamWriter(bytes, {
  filename: 'report.json',
  preset: 'balanced',          // 'fast' | 'balanced' | 'dense' | 'extreme'
  passphrase: 'optional',      // omit for a clear transfer
});

writer.k;          // number of source blocks
writer.blockSize;  // bytes per frame

for await (const packet of writer.packets()) {
  // packet: Uint8Array — render it with packetToMatrix below
}
```

```ts
import { createQrStreamReader } from 'qr-stream';

const reader = createQrStreamReader();
reader.add(packetBytes);      // 'accepted' | 'duplicate' | 'stale-session' | 'invalid'
reader.progress();            // { solved, k }
reader.sessionId();           // locks to the first stream it sees

const result = await reader.result('optional passphrase');
// null until complete, else { data: Uint8Array, meta: StreamMeta }
// throws WrongKeyError for a bad passphrase — retry without rescanning
```

Rendering and capture live behind their own entry points:

```ts
import { packetToMatrix, matrixToRGBA, qrCapacity } from 'qr-stream/qr';
import { renderQrStream, readQrStream, quantizeFps } from 'qr-stream/browser';
```

## React API

```tsx
import { QrStreamSender, QrStreamReceiver } from 'qr-stream/react';

<QrStreamSender />

<QrStreamReceiver
  wasmUrl="/assets/zxing_reader.wasm"   // required offline; the default is a CDN
  onComplete={(data, filename) => save(data, filename)}
/>
```

The receiver shows its camera picker only when the device reports more than one
camera, and always offers a one-tap "switch camera" over the preview. On Android
where several rear modules are advertised, the wrong one frequently will not
focus close enough to scan — that button is the fix.

Hooks, when you want your own layout:

```ts
useQrStreamWriter({ data, filename, preset, passphrase }) // { writer, error }
useQrStreamReader({ passphrase })                        // { progress, solveRate, result, wrongKey, add, retryKey, reset }
useCameraReader({ deviceId, onSymbol, wasmUrl })         // { videoRef, devices, activeId, select, cycle, switching, error }
```

## Offline requirements

Two things bite exactly once, in the room, when you cannot debug them:

1. **`getUserMedia` needs a secure context.** Load the app once over HTTPS (or
   `localhost`) and install it before you airgap the devices.
2. **The WASM decoder must be precached.** `vite-plugin-pwa` will not include a
   `.wasm` that came from `node_modules` unless you add `**/*.wasm` to
   `workbox.globPatterns`. `demo/vite.config.ts` does this; verify it by
   searching the built `sw.js` for `zxing_reader`.

## Presets

| Preset | QR version | Bytes/frame | Default fps | Frames for 250 KiB |
|---|---|---|---|---|
| `fast` | 20 | 838 | 15 | ~306 |
| `balanced` | 25 | 1253 | 12 | ~205 |
| `dense` | 30 | 1712 | 10 | ~150 |
| `extreme` | 40 | 2933 | 6 | ~88 |

All presets use error-correction level **L**. Every frame carries a CRC-32, so a
misread frame is dropped and becomes an erasure the fountain code absorbs;
raising ECC pays for that tolerance twice.

The demo quantises the requested frame rate to a divisor of the display refresh
rate, because a code shown for a non-integer number of refreshes gets captured
mid-switch as blur.

## Testing

```bash
pnpm test          # 103 tests, DOM-free
pnpm typecheck
pnpm build
pnpm demo:build
```

The highest-value test is `tests/loopback.test.ts`: it rasterises real packets
and decodes them with the same `zxing-wasm` build the receiver uses. No camera
involved. Density bugs are silent until a camera is pointed at them, so this
runs in the suite.

## Consuming the built package

`dist/` ships ESM plus declarations whose relative imports are extensionless, so
consumers should use `"moduleResolution": "bundler"` (the default for Vite,
Next, and modern webpack). A Node16/NodeNext consumer will need to point at the
sources or add the extensions itself.

All four entry points are verified by installing the package into an empty
project and importing it, not just by running the tests.

## Limits

- One file per transfer. No resume across a reload — a human restarts it.
- No history, no chat, no two-way stream.
- ~15 KB/s at best. A 250 KiB incompressible file is about 20 seconds of
  holding a phone steady.
- Encryption protects against a bystander recording the screen. It does not
  protect against a weak passphrase: a spoken three-word phrase is crackable
  offline in about a day. Six words or a random passphrase.
