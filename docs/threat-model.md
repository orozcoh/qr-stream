# Threat model

qr-stream moves one file from one screen to one camera with no network path
between the devices. That removes a whole class of remote attacks and leaves a
different set: the receiver parses bytes chosen by whoever controls the screen,
the browser runs a WebAssembly decoder, and the camera is a privacy-sensitive
device.

This page states what the library does and does not defend against, so a host
can make an informed decision instead of assuming "offline" means "safe".

The policy side — which versions are supported, how to report privately, and
what to expect — is [SECURITY.md](../SECURITY.md).

- [Trust boundaries](#trust-boundaries)
- [Threats and controls](#threats-and-controls)
  - [Malicious QR payloads](#malicious-qr-payloads)
  - [Gzip bombs](#gzip-bombs)
  - [KDF denial of service](#kdf-denial-of-service)
  - [Filename injection](#filename-injection)
  - [WASM supply chain and no CDN](#wasm-supply-chain-and-no-cdn)
  - [Camera privacy](#camera-privacy)
  - [No telemetry](#no-telemetry)
- [Checksums and AES-GCM](#checksums-and-aes-gcm)
- [Limits as a security control](#limits-as-a-security-control)
- [Out of scope](#out-of-scope)
- [Reporting](#reporting)

## Trust boundaries

| Component | Trust |
| --- | --- |
| Sender application | Trusted by the sender. It chooses the file and passphrase. |
| Screen and QR frames | **Untrusted.** Anyone in the room can display a different code. |
| Receiver application | Trusted by the receiver. It decides what to save and where. |
| `zxing-wasm` and the `.wasm` asset | Installed/build-time code. Its integrity is the host's build and origin. |
| Browser, camera stack, OS | Trusted platform. A compromised browser defeats every control here. |

The sender and receiver never share a secret unless the user supplies a
passphrase. There is no pairing, no key exchange, and no back channel, so the
receiver cannot authenticate *who* is sending. It can only authenticate that the
bytes it reassembled match the metadata that arrived with them.

## Threats and controls

### Malicious QR payloads

The receiver's parser is the exposed surface. A hostile frame is handled as
follows:

- `decodePacket` requires the `QS` magic, the exact length implied by the
  header, a consistent `payloadLen`, and a matching CRC-32. Anything else is an
  erasure, not an exception.
- The reader rejects an unknown wire version, reserved flag bits, `k` outside
  `1..MAX_SOURCE_BLOCKS`, `blockSize` above the writer's maximum frame payload,
  and a declared `k × blockSize` larger than the wire budget plus metadata and
  one block. A 21-byte frame cannot drive unbounded fountain work.
- The reader locks `sessionId`, `k`, `blockSize`, and `flags` to the first frame
  it accepts. A later frame that disagrees is `invalid` or `stale-session`; a
  frame from another transfer cannot contaminate the current one.
- Metadata parsing is bounds-checked: version, filename length, fixed fields,
  salt/nonce lengths, iteration count, and trailing bytes. Malformed metadata
  becomes `INVALID_METADATA` (`rescan`), not an out-of-bounds read.
- The decompressor is cancelled at the decoded cap (see below), and the final
  SHA-256 must match before the caller receives bytes.

The payload is still **untrusted file content**. The library does not execute,
parse, or open it. A host that saves it and then opens it has taken on the usual
document-parser risk; that is outside this library.

### Gzip bombs

Three separate bounds stop an expansion attack:

1. The wire body is at most `MAX_WIRE_BYTES` (1 MiB) by construction, and a
   reader with a tighter `maxWireBytes` rejects a larger declared stream before
   locking.
2. `gunzip` enforces `maxDecodedBytes` **while reading**. It cancels the stream
   at the cap instead of buffering the whole member and checking afterwards, so
   peak allocation stays near the cap plus one chunk.
3. The metadata `plainLen` is checked against the reader's decoded budget before
   decompression, then the actual output length is compared with it after.

The default decoded cap is 8 MiB. A host can lower it; no host can raise it past
the library ceiling.

### KDF denial of service

Encrypted streams store their PBKDF2 iteration count so old streams stay
readable. That field is peer-controlled, so the reader caps it at 2,000,000
iterations and rejects anything higher as `INVALID_METADATA`. The writer uses
600,000.

The cost is paid only when a stream is **complete** and `result()` is called,
not per frame. `useQrStreamReader` also coalesces concurrent finishes, so a burst
of final frames cannot start several derivations at once. An attacker who can
display a complete stream can still force one bounded PBKDF2 derivation; that is
the price of supporting a password-based key, and it is measured in seconds, not
unbounded work.

### Filename injection

The filename travels inside the metadata block and is peer-controlled. The
library sanitizes it on both encode and decode:

- control characters, bidi overrides/isolates, line/paragraph separators, and
  `/` or `\` path separators are removed;
- the result is trimmed and truncated to 64 UTF-8 bytes on a code-point
  boundary (and re-truncated after decoding, so invalid UTF-8 cannot expand past
  the bound);
- an empty result becomes `payload`;
- for encrypted streams the exact metadata block is AES-GCM additional
  authenticated data, so changing the filename fails decryption rather than
  silently renaming the file.

Sanitizing a name is not a path policy. A host that writes to disk must treat the
name as a display label, keep its own destination directory, and never
concatenate it into a privileged path. In the browser, the packaged receiver uses
a `download` attribute on a blob URL; it never writes to the filesystem.

### WASM supply chain and no CDN

- The library performs **no runtime network requests**. There is no telemetry
  endpoint, no font fetch, and no implicit decoder download.
- `zxing-wasm` is an optional peer dependency. It is installed and bundled by the
  host, not fetched at runtime.
- `createZXingDecoder({ wasmUrl })` requires an explicit URL. The decoder's
  implicit CDN fallback is deliberately disabled: a CDN fallback works online and
  fails in the airgap, turning a build error into a field failure.
- Serve `zxing_reader.wasm` from your own origin (typically a Vite `?url` import)
  and precache it. A strict CSP should allow only `'self'` for scripts and
  workers.
- The `.wasm` bytes are only as trustworthy as your build and origin. Pin the
  dependency with a lockfile, review upgrades, and do not load the asset from a
  third-party host. If your threat model includes a compromised origin, the
  attacker controls the decoder and therefore the bytes it produces; no
  library-level check can recover from that.

### Camera privacy

- The camera is opened only when the host mounts an enabled reader, calls
  `start()`, or calls `readQrStream`. Nothing opens it at import time.
- `stop()`, `enabled: false`, unmount, and a failed setup all stop every track,
  clear `video.srcObject`, and dispose the decoder. A late `getUserMedia` or
  decoder result that loses the race is released instead of installed.
- The video stream is never recorded and never uploaded. The browser's camera
  indicator remains the authoritative signal.
- The only camera-related persistence is `localStorage['qr-stream:camera']`,
  which stores the last `deviceId` so a restart can reuse the camera. It contains
  no image, audio, filename, or payload.
- A host that adds its own recording or upload is outside this model; the library
  neither provides nor prevents it.

### No telemetry

There is no analytics, crash reporting, or "phone home" code in the package. The
library does not know or report the filename, payload, passphrase, device model,
or transfer outcome. The only network activity in a deployment is:

- the browser fetching the app and the `.wasm` asset from your origin, and
- the package manager fetching the package at install time.

### Checksums and AES-GCM

| Mechanism | What it proves | What it does not |
| --- | --- | --- |
| CRC-32 per frame | The frame arrived intact enough to parse. | Nothing about authenticity; it is not a MAC. |
| SHA-256 in metadata | The reassembled bytes match the hash that arrived with the stream. | It does not prove *who* chose the hash. A malicious sender can send a different file with a matching hash. |
| AES-256-GCM (passphrase) | Confidentiality and integrity under a key derived from the passphrase. Metadata is AAD. | It does not make a weak passphrase strong. |
| PBKDF2-SHA256, 600,000 iterations | Raises the cost of guessing a passphrase. | It cannot stop an offline guessing attack against a short or common phrase. |

For an **unencrypted** transfer, SHA-256 catches corruption and a truncated or
mismatched stream, but it is not a signature. Someone who can control the screen
can display a different valid stream; the receiver has no identity to check.
Encryption with a passphrase shared out of band is the only way to bind the
transfer to a secret.

A wrong passphrase and a damaged payload are indistinguishable: both fail GCM
authentication and surface as `WRONG_PASSPHRASE`. The reader keeps the
ciphertext, so a retry does not require another scan. Use six random words or a
generated passphrase; a spoken three-word phrase is crackable offline.

## Limits as a security control

The constants are not just UX budgets; they bound work an attacker can request:

| Bound | Value | Stops |
| --- | --- | --- |
| `MAX_WIRE_BYTES` | 1 MiB | A stream larger than the receiver will ever need to assemble. |
| `MAX_INPUT_BYTES` | 8 MiB | A sender preparing a huge raw allocation. |
| `MAX_DECODED_BYTES` | 8 MiB | A gzip bomb expanding without limit. |
| `MAX_SOURCE_BLOCKS` | 1252 | A tiny frame declaring a huge `k` and driving superlinear fountain work. |
| Max `blockSize` | 2933 | A frame declaring a block larger than a legal QR payload. |
| Max KDF iterations | 2,000,000 | An absurd PBKDF2 count in peer metadata. |
| 60 consecutive decode failures | one report | A decoder that is silently broken, instead of endless per-frame errors. |

A caller can tighten the size limits with `limits`; a value that is not a
positive integer at or below the hard ceiling is rejected with
`INVALID_ARGUMENT`. A caller cannot raise them.

## Out of scope

- A compromised sender or receiver device, browser, camera driver, or OS.
- Malicious JavaScript in the host application, or an XSS that can call the
  library's APIs.
- A compromised package registry or build pipeline. Lockfiles and provenance
  reduce this risk; they do not eliminate it.
- Shoulder surfing, a bystander photographing the screen, or a camera pointed at
  a display. Encryption protects the payload from a recording only as far as the
  passphrase is strong.
- Denial of service by blocking the line of sight, shaking the camera, or
  displaying a different stream forever. The protocol has no back channel and no
  way to distinguish "keep pointing" from "give up".
- QR phishing or a malicious *other* app scanning the sender's screen. The
  sender's screen is visible to anything in the room.
- Side channels in the browser's Web Crypto, compression, or WebAssembly
  implementations.
- Files after they are saved. The host owns destination paths, permissions, and
  any later opening of the file.

## Reporting

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting channel for this repository:
<https://github.com/orozcoh/qr-stream/security/advisories/new>. The supported
versions, the reporting process, and the disclosure window are in
[SECURITY.md](../SECURITY.md), which is the authoritative policy; this page is
the threat analysis behind it.

A useful report includes the affected version, the exact `code`/`recovery`
values, a minimal packet or stream if you can share one safely, and the
browser/OS matrix where it reproduces.
