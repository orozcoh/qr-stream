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
- [Integration guide](docs/integration.md)
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

Payload limits are split by what they bound: up to **8 MiB of raw input**,
**1 MiB on the compressed wire**, and **8 MiB decoded** on the receiving side.
Typical JSON compresses 3–8×, so the common case transfers in a few seconds.

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

## Install

```bash
npm install @orozcoh/qr-stream
```

The codec entry has no dependencies. The React entry needs React 18 or newer,
and the decoder needs `zxing-wasm` (see [Decoders](#decoders)). Neither is
installed for you, so a project that only encodes ships neither.

## Version compatibility

`0.3.0` keeps the same wire format and moves the payload budgets to the
raw/wire/decoded split described in [Limits](#limits). A `0.3.0` stream is
readable by a `0.2.0` receiver for plaintext up to 1 MiB; set
`limits: { maxInputBytes: 1024 * 1024 }` on the sender if every transfer must
stay readable by an older device. See
[Limits and version compatibility](docs/integration.md#5-limits-and-version-compatibility).

`0.2.0` authenticates the metadata block of an encrypted transfer with AES-GCM
additional authenticated data. A `0.2.0` receiver cannot decrypt a `0.1.x`
encrypted stream, and a `0.1.x` receiver cannot decrypt a `0.2.0` encrypted
stream; update both devices before a transfer. Unencrypted streams are
unaffected.

## Library API

```ts
import { createQrStreamWriter, createQrStreamReader } from '@orozcoh/qr-stream';

const writer = await createQrStreamWriter(bytes, {
  filename: 'report.json',
  preset: 'balanced',          // 'fast' | 'balanced' | 'dense' | 'extreme'
  passphrase: 'optional',      // omit for a clear transfer
});

writer.k;            // number of source blocks
writer.blockSize;    // bytes per frame
writer.version;      // QR version the preset encoded into every packet
writer.wireBytes;    // compressed body before encryption; equals meta.wireLen
writer.payloadBytes; // varint + metadata + wire body (and GCM tag when encrypted)
writer.packets();    // infinite async generator of packet bytes (low-level use)
```

```ts
import { createQrStreamReader } from '@orozcoh/qr-stream';

const reader = createQrStreamReader();
reader.add(packetBytes);      // 'accepted' | 'duplicate' | 'stale-session' | 'invalid'
reader.progress();            // { solved, k }
reader.sessionId();           // locks to the first stream it sees

const result = await reader.result('optional passphrase');
// null until complete, else { data: Uint8Array, meta: StreamMeta }
// The verified result is memoized: repeated calls return the same array, so
// treat it as read-only.
// throws WrongKeyError for a bad passphrase — retry without rescanning
```

Rendering and capture live behind their own entry points:

```ts
import { packetToMatrix, matrixToRGBA, qrCapacity } from '@orozcoh/qr-stream/qr';
import { renderQrStream, readQrStream, quantizeFps } from '@orozcoh/qr-stream/browser';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';

const canvas = document.querySelector('canvas')!;
const controller = renderQrStream({ writer, canvas });
controller.play();
// controller.stop() clears the last frame and releases the iterator
```

## React API

```tsx
import { QrStreamSender, QrStreamReceiver } from '@orozcoh/qr-stream/react';

// The hook calls this factory each time it opens the camera; defining it once
// keeps the option stable instead of allocating a new function per render.
const createDecoder = () => createZXingDecoder({ wasmUrl: '/assets/zxing_reader.wasm' });

<QrStreamSender
  title="Share a file"                     // heading, default "qr-stream"
  accept=".json"                           // optional; omitted accepts any file
  maxBytes={512 * 1024}                    // optional tighter cap
  limits={{ maxInputBytes: 1024 * 1024 }}  // optional tighter budget
  strings={{ start: 'Start' }}             // any label is translatable
  formatError={(error) => t(`error.${error.code}`)}
/>

<QrStreamReceiver
  decoder={createDecoder}
  formatError={(error) => t(`error.${error.code}`)}
  onComplete={(data, filename) => save(data, filename)}
/>
```

Every visible label comes from `strings` (`Partial<QrStreamStrings>`, defaults in
`DEFAULT_QR_STREAM_STRINGS`) and uses `{placeholder}` templates, so one prop
translates the whole component. `formatError` receives the typed error, so a
host maps `error.code` to a translated sentence instead of matching on English
messages.

Both components are self-contained: they paint their own background, centre
themselves, and carry no page-level assumptions, so dropping one into a modal
is the intended use. Styles are injected once, every rule sits inside
`:where()` (zero specificity), and colours are `--qrs-*` custom properties — so
a host restyles them with an ordinary selector instead of fighting back:

```css
.qrs { --qrs-accent: #6366f1; --qrs-bg: #0b1120; }
```

`accept` is enforced, not just declared: the attribute only filters the native
picker, so drag-and-drop and "All files" are checked in code and refused with a
specific message.

The receiver shows its camera picker only when the device reports more than one
camera, and always offers a one-tap "switch camera" over the preview. On Android
where several rear modules are advertised, the wrong one frequently will not
focus close enough to scan — that button is the fix.

Hooks, when you want your own layout:

```ts
useQrStreamWriter({ data, filename, preset, passphrase, limits }) // { writer, error, pending }
useQrStreamReader({ passphrase, limits })                         // { progress, solveRate, result, wrongKey, stale, error, add, retryKey, reset }
useCameraReader({ deviceId, onSymbol, createDecoder, enabled })   // { videoRef, devices, start, stop, error, torch, ... }
```

All three report failures as a typed `QrStreamError | null`; branch on
`error.code` and `error.recovery` rather than matching a message. `enabled`
defaults to `true` and closes the camera when it turns `false`, while manual
`start()`/`stop()` let a host drive the lifecycle itself. `useCameraReader` also
exposes `torchSupported`, `torch`, and `setTorch(on)`.

`videoRef` is typed as `QrVideoRef`, a plain `{ current: HTMLVideoElement | null }`
that is assignable to both React 18 and React 19 refs without a cast.

## Decoders

The package ships **no** decoder. `readQrStream` takes one:

```ts
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';

const decode = await createZXingDecoder({ wasmUrl: '/assets/zxing_reader.wasm' });
await readQrStream({ video, decode });
```

`zxing-wasm` is an **optional peer dependency**, so a project that only encodes
(or only uses the sender) never installs it. `@orozcoh/qr-stream/browser` itself imports
no QR library; only `@orozcoh/qr-stream/browser/zxing` does. If you forget to install the
peer, the bundler fails at build time naming the package.

`wasmUrl` is required, and there is no CDN fallback: the decoder loads from the
asset you name or the transfer does not work. That is what makes the offline
PWA honest — see the [integration guide](docs/integration.md#4-offline-pwa-checklist).

`createZXingDecoder` is the only decoder provided. That is a deliberate
decision, and the interface above is what keeps it a decision rather than a
lock-in: adding another decoder later is purely additive.

What we know, separated by how we know it:

- **Measured:** `BarcodeDetector` cannot carry this stream. Against a real
  packet it reports `found: 1` and returns an empty `rawValue`, because a
  packet is binary by construction (magic, u32 fields, CRC) and its only
  output is text. An ASCII payload round-trips through the same pipeline
  byte-perfect, so the detector works — the format does not fit.
- **Believed, not measured:** jsQR (~40 KB gzipped, binary-safe via
  `binaryData`) is weaker than ZXing on dense codes at 10-15 fps, and it has
  had no release since 2019. We have not benchmarked it against this
  project's frames, so treat that as an expectation rather than a finding.
- **Structural:** the decoder is injected, so swapping one in a project that
  needs smaller output costs an import, not a fork.
`BarcodeDetector` — the built-in alternative, and free of bytes — exposes its
result as `rawValue`, a **string**. Measured against a real packet in Chrome:
the detector finds the code and returns an empty string, because a packet is
binary by construction (magic, u32 fields, CRC). An ASCII payload round-trips
byte-perfect through the same pipeline, so the detector works; it just cannot
carry our format. A text-safe encoding would fix it at roughly 33% of the QR
capacity, which is not a trade worth making silently.

## Offline requirements

Three things bite exactly once, in the room, when you cannot debug them:

1. **`getUserMedia` needs a secure context.** Load the app once over HTTPS (or
   `localhost`) and install it before you airgap the devices.
2. **The WASM decoder must be precached.** `vite-plugin-pwa` will not include a
   `.wasm` that came from `node_modules` unless you add `**/*.wasm` to
   `workbox.globPatterns`, and the asset must fit
   `workbox.maximumFileSizeToCacheInBytes`. `demo/vite.config.ts` does this;
   verify it by searching the built `sw.js` for `zxing_reader`.
3. **Copy the WASM to your own origin and pass `wasmUrl`.** Import
   `zxing-wasm/reader/zxing_reader.wasm?url` and hand that URL to
   `createZXingDecoder`. There is no CDN fallback, so the asset either loads
   from your origin or the transfer fails offline. A strict CSP also needs
   `script-src 'self' 'wasm-unsafe-eval'`.

The full checklist, including the Workbox and CSP snippets, is in the
[integration guide](docs/integration.md#4-offline-pwa-checklist).

## Presets

| Preset | QR version | Bytes/frame | Default fps | Blocks for 1 MiB |
|---|---|---|---|---|
| `fast` | 20 | 838 | 15 | ~1252 |
| `balanced` | 25 | 1253 | 12 | ~838 |
| `dense` | 30 | 1712 | 10 | ~614 |
| `extreme` | 40 | 2933 | 6 | ~358 |

All presets use error-correction level **L**. Every frame carries a CRC-32, so a
misread frame is dropped and becomes an erasure the fountain code absorbs;
raising ECC pays for that tolerance twice.

The demo quantises the requested frame rate to a divisor of the display refresh
rate, because a code shown for a non-integer number of refreshes gets captured
mid-switch as blur.

## Runtime requirements

The core needs `CompressionStream` and `crypto.subtle`; Node 20+ or any
current browser. The React entry needs React 18 or newer. The decoder needs
`zxing-wasm`, installed separately.

## Testing

```bash
pnpm test          # DOM-free suite
pnpm typecheck
pnpm build
pnpm demo:build
```

The highest-value test is `tests/loopback.test.ts`: it rasterises real packets
and decodes them with the same decoder the receiver uses. No camera
involved. Density bugs are silent until a camera is pointed at them, so this
runs in the suite.

## Deploy

The demo is a static bundle served by a Worker with no script — Cloudflare
serves the assets directly, so requests for the app cost nothing.

```bash
pnpm demo:build          # -> demo/dist
pnpm deploy:dry          # validate config + asset resolution, uploads nothing
pnpm deploy              # local wrangler deploy, needs credentials
```

`wrangler.jsonc` pins `workers_dev: false`, so the only origin is
`qr-stream.digitalerror.xyz`. That matters for a PWA: an installed app is
scoped to its origin, so leaving a `*.workers.dev` URL alive would give you two
independent installs and two independent caches of the same app.

### Prerequisites, once

1. The `digitalerror.xyz` zone must be active on the same Cloudflare account.
2. `qr-stream.digitalerror.xyz` must **not** already have a CNAME — Cloudflare
   refuses a Custom Domain over an existing record. Delete it in DNS first.
3. Create an API token with:
   - Account → **Workers Scripts: Edit**
   - Zone → **Workers Routes: Edit**
   - Zone → **DNS: Edit** (the custom-domain attach writes DNS and a certificate)

   Store the token and account id as **`production` environment secrets**
   (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), not repository secrets.
   Repository/org secrets are readable by same-repo PR workflows, including a
   PR-edited `verify.yml`; `environment: production` does not scope a repository
   secret. In the repository settings, create the `production` environment and
   restrict it to `main` (and no attacker-controlled tags).

   If you would rather not give CI DNS rights, attach the domain once in the
   dashboard (*Settings → Domains & Routes → Add → Custom Domain*) and delete
   the `routes` entry from `wrangler.jsonc`; then `Workers Scripts: Edit` alone
   is enough. That also removes the zone DNS write from the credential.

### Continuous deployment

Verification and deployment are separate workflows:

- **`.github/workflows/verify.yml`** runs on pull requests only, with no
  credentials: install, typecheck, test, build the library, build the demo.
- **`.github/workflows/deploy.yml`** runs on pushes to `main` and manual
  dispatch: the same verification, then `pnpm exec wrangler deploy` using the
  lockfile-pinned Wrangler. The job declares the `production` environment;
  store the Cloudflare credentials as environment secrets and restrict that
  environment to `main`. The environment rule, not the workflow text, is what
  keeps a branch-pushed copy of the file from reading the credentials. Manual
  dispatch is main-gated.

The deploy job fails if the live site is missing
`Permissions-Policy: camera=(self)`, `Content-Security-Policy`, or
`Strict-Transport-Security`, or if the served `index.html` does not reference
the asset hash that was just built.

There are no preview deployments. A `wrangler versions upload` preview keeps
every version in the account; each `deploy` instead replaces the last one, so
only one version is ever live.

### After the first deploy

Open `https://qr-stream.digitalerror.xyz` on each device once and install it.
That single visit is what caches the app and the WASM decoder; after it, the
devices work with no network at all.

## Release

Two phases, both behind an auth preflight (`gh` must be the repo owner and
`npm whoami` must succeed):

```bash
pnpm release:check   # read-only: auth, branch, sync, version, tag, npm, release
pnpm release:prepare 0.3.0   # bump, changelog check, tests, PR, verify, merge
pnpm release:publish         # tag, npm publish, GitHub release, smoke test
```

- `release:prepare` requires a `## <version>` section in `CHANGELOG.md`; it
  refuses to bump without one. You can write that section on `main` and leave
  it uncommitted: `prepare` includes it in the release commit, so the changelog
  and the bump pass `verify` in the same PR.
- `release:publish` refuses if the version is already on npm, the tag points
  elsewhere, or the GitHub release exists; use `--resume` / `--update-release`
  to recover.
- `--dry-run` prints the actions without changing anything. `--yes` skips the
  confirmations. `--skip-checks` and `--skip-deploy-check` are escape hatches
  for a broken runner, not the normal path.
- `release:prepare` waits for the deploy run; if GitHub misses the push event,
  it dispatches `deploy.yml` from `main` instead of silently skipping the
  deploy check.
- For a 2FA account: `NPM_OTP=123456 pnpm release:publish`.

The repo’s `main` ruleset requires a PR and the `verify` check, so
`release:prepare` merges only after CI passes.

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
- **Three budgets, not one.** Raw input may be up to **8 MiB**
  (`MAX_INPUT_BYTES`), the compressed body before encryption up to **1 MiB**
  (`MAX_WIRE_BYTES`), and the decoded result up to **8 MiB**
  (`MAX_DECODED_BYTES`). Compression runs first, so a large JSON document can
  fit the wire cap even when its raw size is several times larger.
- **The writer reports the split.** `writer.plainBytes` is the original input,
  `writer.wireBytes` the compressed body (`meta.wireLen`), and
  `writer.payloadBytes` the full assembled payload including metadata and, when
  encrypted, the GCM tag.
- **Limits only tighten.** `limits.maxWireBytes` and `limits.maxInputBytes` on
  the writer, and `limits.maxWireBytes` / `limits.maxDecodedBytes` on the
  reader, may lower a default but never raise it. A limit that is not a positive
  integer at or below the hard ceiling is rejected with `INVALID_ARGUMENT`.
- **0.2 interop:** the wire format is unchanged. A 0.3 stream is readable by a
  0.2 receiver for plaintext up to 1 MiB. For a mixed-version fleet, opt down
  with `limits: { maxInputBytes: 1024 * 1024 }` on the sender.
- **1 MiB on the wire is minutes, not seconds.** At the `fast` preset an
  incompressible megabyte is K = 1252 blocks, roughly 146 seconds of scanning at
  1.75x overhead. JSON compresses 3-8x, so a typical 1 MiB document finishes in
  15-30 seconds. The sender shows the estimate once the file is loaded.
- Encryption protects against a bystander recording the screen. It does not
  protect against a weak passphrase: a spoken three-word phrase is crackable
  offline in about a day. Six words or a random passphrase.

See [Limits and version compatibility](docs/integration.md#5-limits-and-version-compatibility)
for the constants, the writer fields, and the 0.2 opt-down recipe.
