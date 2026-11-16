# Support

This is a volunteer-maintained open source project. Support is best-effort and
public: there is no private support channel and no response-time guarantee.

## Read first

Most questions are already answered in the docs:

- [README](README.md) — install, entry points, presets, limits, offline
  checklist.
- [Integration guide](docs/integration.md) — hosts, PWA/WASM precaching, camera
  lifecycle, limits, error handling, styling, and i18n.
- [Troubleshooting](docs/troubleshooting.md) — offline WASM, camera failures,
  passphrases, CSP, React, and canvas sizing.
- [Threat model](docs/threat-model.md) — what the library does and does not
  defend against.
- [API reference](https://orozcoh.github.io/qr-stream/) — generated TypeDoc.

## Ask a question

Open a [GitHub issue](https://github.com/orozcoh/qr-stream/issues/new/choose)
and describe what you are building. Include the package version, the entry
points you import, the browser or Node version, and the exact error `code` and
`recovery` value if a `QrStreamError` was raised. A minimal reproduction — two
short files, or a failing test — is worth more than a screenshot.

Use the bug report form when something is broken. Use the feature request form
for a proposal; the preset, limit, and wire-format design is documented, so
describe the constraint you hit rather than only the API you want.

## Report a bug

[Open a bug report](https://github.com/orozcoh/qr-stream/issues/new?template=bug_report.yml).
Check the troubleshooting guide first: offline `DECODER_FAILED`, camera
selection, and limit errors have known fixes.

## Report a security issue

Do **not** open a public issue. Use GitHub private vulnerability reporting:

<https://github.com/orozcoh/qr-stream/security/advisories/new>

The supported versions and the reporting process are in [SECURITY.md](SECURITY.md).
The same channel is available for a confidential code-of-conduct report; see
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Scope and expectations

- The supported surface is the five published entry points and the demo PWA.
  A fork, a patched copy, or a custom decoder is your own responsibility.
- Only the versions listed in [SECURITY.md](SECURITY.md) are supported.
- Questions about a host application's architecture, bundler, or CSP are
  usually answered by the integration guide, not by the maintainer.
- There is no SLA. A well-scoped report with a reproduction is triaged faster
  than a broad question, and a security report always takes priority over a
  usage question.

Bugs in third-party dependencies should be reported upstream; a note here is
still welcome if it affects this package.
