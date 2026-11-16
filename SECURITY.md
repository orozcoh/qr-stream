# Security policy

qr-stream transfers a file over an optical channel: one screen displays QR
frames, one camera reads them. There is no network path between the devices, so
the remote attack surface is small. What remains is real: the receiver parses
bytes chosen by whoever controls the screen, the browser executes a WebAssembly
decoder, and the camera is a privacy-sensitive device.

This page is the operational policy. The reasoning behind each control, and
what is explicitly out of scope, lives in
[docs/threat-model.md](docs/threat-model.md).

## Supported versions

| Version | Supported | Notes |
| --- | --- | --- |
| `0.3.x` | Yes | Current line. Security fixes ship as patch releases. |
| `0.2.x` | No | Unsupported. A fix is backported only when an advisory names that version. |
| `0.1.x` and older | No | Unsupported; upgrade to `0.3.x`. |

Only the newest patch of a supported minor line receives fixes. The wire format
is unchanged between `0.2` and `0.3`, so upgrading is a package change rather
than a protocol migration for plaintext payloads up to 1 MiB. See
[Version compatibility](README.md#version-compatibility).

The demo deployment at `qr-stream.digitalerror.xyz` tracks `main`. Reports about
the deployed origin — security headers, the service worker, the CSP, or a
misconfigured cache — are in scope even when the library itself is fine.

## Reporting a vulnerability

**Use GitHub private vulnerability reporting. Do not open a public issue.**

<https://github.com/orozcoh/qr-stream/security/advisories/new>

That channel is private between you and the maintainer, supports a draft
advisory, and lets a fix ship with a coordinated disclosure. There is no
security email address; the repository has none, and inventing one would only
send reports nowhere.

A useful report includes:

- the affected version (`npm ls @orozcoh/qr-stream` or the CDN build you used);
- the entry point involved: `/`, `/browser`, `/qr`, `/react`, or
  `/browser/zxing`;
- the exact `QrStreamError` `code` and `recovery` value, if one was raised;
- a minimal packet, stream, or payload when you can share one safely — a hex
  dump of a few frames is usually enough;
- the browser, OS, and device matrix where it reproduces;
- whether the impact needs the attacker to control the screen, the sender, or
  only the file content.

Please avoid attaching real documents, passphrases, or camera captures. A
synthetic payload that reproduces the behavior is more useful than the original
file.

### What to expect

- Acknowledgement on a best-effort basis, normally within seven days.
- An assessment and a remediation plan, or an explanation of why the behavior
  is out of scope, after triage.
- A coordinated disclosure window of up to 90 days from the report. We will
  agree on a date; a fix that ships earlier ends the embargo earlier.
- Credit in the advisory unless you ask to stay anonymous.

This is a volunteer project. There is no bug bounty, no paid support, and no
response-time SLA.

## Threat model summary

The full document, including the trust boundaries and the limits that act as
security controls, is [docs/threat-model.md](docs/threat-model.md). In short:

- **Malicious QR payloads.** Frames are untrusted. The parser requires the `QS`
  magic, an exact length, a consistent `payloadLen`, and a matching CRC-32;
  anything else is an erasure. The reader locks `sessionId`, `k`, `blockSize`,
  and `flags` to the first accepted frame, and metadata parsing is
  bounds-checked. The payload is still untrusted *file content*: the library
  never executes, parses, or opens it.
- **Gzip bombs.** The compressed body is capped at 1 MiB, decompression is
  cancelled at `maxDecodedBytes` while reading (not afterwards), and the
  declared `plainLen` is checked before and after decompression. The decoded cap
  is 8 MiB by default.
- **KDF denial of service.** PBKDF2 iterations come from peer metadata, so the
  reader rejects anything above 2,000,000 and pays the cost once, when a
  complete stream is finished — never per frame.
- **Filename injection.** Control characters, bidi overrides, separators, and
  line breaks are stripped; the name is truncated to 64 UTF-8 bytes; an empty
  result becomes `payload`. For encrypted streams the metadata block is AES-GCM
  additional authenticated data, so a modified filename fails decryption.
  Sanitizing a name is not a filesystem policy: a host must keep its own
  destination directory.
- **WASM supply chain.** No runtime network requests, no CDN fallback. The
  decoder is installed and served by the host.
- **Camera privacy.** The camera opens only when the host asks it to, every
  track is stopped on `stop()`, unmount, or failure, and nothing is recorded or
  uploaded.

### No telemetry

The package contains no analytics, no crash reporting, and no "phone home"
code. It does not know or report the filename, payload, passphrase, device
model, or transfer outcome. A deployment's only network activity is the browser
fetching the app and the `.wasm` asset from your origin, plus the package
manager fetching the package at install time.

### WASM and CDN guidance

`@orozcoh/qr-stream/browser/zxing` loads its decoder from an explicit `wasmUrl`.
There is no implicit CDN fallback, because a CDN works online and fails in the
airgap — turning a build error into a field failure.

- Serve `zxing_reader.wasm` from your own origin, typically via a Vite `?url`
  import, and precache it.
- Pin `zxing-wasm` with a lockfile, review upgrades, and never load the asset
  from a third-party host.
- Allow only `'self'` for scripts and workers, and `'wasm-unsafe-eval'` — not
  the broader `'unsafe-eval'` — for WebAssembly compilation.
- Verify the built service worker references the hashed asset; see the
  [offline checklist](README.md#offline-checklist).

If your threat model includes a compromised origin, the attacker controls the
decoder and therefore the bytes it produces. No library-level check can recover
from that.

### Camera privacy

The camera opens only when a reader is mounted and enabled, `start()` is called,
or `readQrStream` is called. Nothing opens it at import time. `stop()`,
`enabled: false`, unmount, and a failed setup stop every track, clear
`video.srcObject`, and dispose the decoder. Frames are never recorded or
uploaded; the browser's camera indicator remains the authoritative signal. The
only camera-related persistence is `localStorage['qr-stream:camera']`, which
holds the last `deviceId` and no image, audio, filename, or payload.

## Out of scope

Reports that depend on a compromised device, browser, camera driver, or OS; on
malicious JavaScript or XSS in the host application; on a compromised registry
or build pipeline; or on shoulder surfing and screen recording are outside this
library's model. The full list is in
[Out of scope](docs/threat-model.md#out-of-scope). Lockfiles and provenance
reduce supply-chain risk; they do not eliminate it.
