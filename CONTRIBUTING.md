# Contributing

Thanks for taking a look. This project has an unusually high bar for evidence:
the reliability, limits, and threat-model claims in the README are backed by
tests, and a change that weakens one of those claims will be asked for proof.

## Setup

Requirements: Node 20 or newer, [pnpm](https://pnpm.io) 11, and — for the
browser tests — a local Chromium that Playwright can install.

```bash
pnpm install
pnpm build          # library: dist/
pnpm test           # DOM-free unit suite, no build needed
pnpm demo:build     # demo PWA: demo/dist/
pnpm demo:preview   # http://localhost:4173
```

The repository is a pnpm workspace: the root package plus
`tests/react18-runtime`, a private fixture that runs the built React entry under
React 18 and jsdom.

## Commands

| Command | What it proves |
| --- | --- |
| `pnpm lint` | ESLint, including import and React hook rules. |
| `pnpm format:check` | Prettier (markdown is excluded by `.prettierignore`). |
| `pnpm typecheck` | The whole repository against the strict `tsconfig.json`. |
| `pnpm typecheck:core` | The DOM-free core compiles without DOM types. |
| `pnpm typecheck:react18` | The public types are usable from React 18. |
| `pnpm test` | The Vitest suite, including the raster/decode loopback. |
| `pnpm test:fuzz` | Property tests for packets, metadata, varint, compression, reader. |
| `pnpm test:coverage` | The suite with V8 coverage. |
| `pnpm test:e2e` | Builds the demo and drives it in Chromium: sender, fake camera, offline PWA. |
| `pnpm bench` | Local benchmark run; `pnpm bench:check` enforces the CI budgets. |
| `pnpm check:package` | `publint`, `attw --profile esm-only`, and `knip` against the packed tarball. |
| `pnpm check:size` | Bundle-size budgets from `.size-limit.json`. |
| `pnpm api:check` | API Extractor reports match `etc/*.api.md`. |
| `pnpm deps:check` | Layer and dependency rules (dependency-cruiser). |
| `pnpm docs:build` | TypeDoc for all five entry points. |

`pnpm test:e2e` needs the browser once: `pnpm exec playwright install --with-deps chromium`.
CI runs it on one Node leg only; that is deliberate, not an oversight.

## Architecture and layer rules

The package is split by what a file is allowed to touch. The rules are enforced
by `.dependency-cruiser.cjs`, so a violation fails `pnpm deps:check` rather than
being caught in review.

| Layer | May import | Constraint |
| --- | --- | --- |
| `src/core/` | `src/core/` only | DOM-free. It must run in Node 20 and in a worker. |
| `src/qr/` | `src/core/`, `src/qr/` | QR matrix encoding/decoding. No canvas, no DOM. |
| `src/browser/` | `src/core/`, `src/qr/`, `src/browser/` | DOM and camera. No Node builtins. |
| `src/react/` | any layer above plus `src/react/` | Components and hooks. No Node builtins. |

Additional invariants:

- Circular imports are forbidden everywhere.
- Only `src/browser/decoders/*` may import `zxing-wasm`. A sender-only bundle
  must never ship the decoder.
- The root entry (`src/index.ts`) is DOM-free. New browser behavior belongs in
  `src/browser.ts`, `src/qr.ts`, or `src/react/index.ts`.
- The core needs `CompressionStream`, `DecompressionStream`, and
  `crypto.subtle`. A missing capability becomes `UNSUPPORTED_RUNTIME`, never a
  raw DOM exception.

## Public API discipline

The exported surface of the five entry points is a contract. It is checked by
API Extractor and recorded in `etc/*.api.md`.

- Adding an export or changing a signature requires `pnpm api:build` and a
  committed update to the matching `etc/*.api.md` report. CI runs `pnpm api:check`
  and fails on drift.
- Prefer additive changes. Removing or re-typing an export is a breaking change
  and needs a major-version plan; between `0.x` releases, call it out in the
  changelog as a migration note.
- Error `code` and `recovery` values are stable API. Messages are not: a message
  may be reworded, a code may not be renamed without an advisory and a
  changelog entry.
- Do not widen a size, wire, or KDF limit without a threat-model update. Those
  constants bound attacker-requested work, not just UX.

## Tests

A change is expected to arrive with the test that would fail without it.

- **Unit** (`tests/*.test.ts`): DOM-free. Prefer these; they run fast and on
  both CI Node versions.
- **Interop** (`tests/fixtures/v0.2/`): frozen 0.2.0 sources. They exist so a
  wire-format change shows up as a failing fixture instead of a field report.
  Do not edit them to make a test pass.
- **Fuzz** (`tests/fuzz/`): `fast-check` properties over packets, metadata,
  varint, compression, and the fountain reader. Set `FUZZ_RUNS=1000` to match
  CI.
- **Loopback** (`tests/loopback.test.ts`): rasterizes real packets and decodes
  them with the same decoder the receiver uses. Density bugs are silent until a
  camera is pointed at them, so this runs in the suite.
- **Browser** (`tests/e2e/`, `*.spec.ts`): Playwright against the built demo,
  including a fake capture device and an offline reload. Add one when the bug
  needs a real canvas, a real camera stack, or a service worker.
- **React** (`tests/react*.test.tsx`, `tests/strict-mode.test.tsx`,
  `tests/ssr.test.tsx`): behavior, accessibility, SSR, and StrictMode.

Performance regressions are budgeted: `bench/budgets.json` holds CI ceilings and
`bench/baseline.json` the committed baseline. If a change is intentionally
slower, update the budget in the same commit and explain why in the message.

## Commits and pull requests

Write conventional-commit subjects, scoped by area, in the imperative mood:

```
feat(reader): reject a block size above the legal frame payload
fix(camera): stop tracks when start() loses the device race
docs(threat-model): state the PBKDF2 iteration cap
test(fuzz): cover metadata with a zero-length filename
chore(deps): bump vite to 8.3.7
```

Keep a commit to one idea. Do not mix formatting churn with behavior; the two
are impossible to review together. Never commit secrets, tokens, `.env` files,
camera captures, or real payloads.

Pull requests target `main` and must pass `verify` (lint, dependency rules,
format, typecheck, tests, fuzz, coverage, build, API report, bench budgets,
demo/examples/docs builds, browser e2e, package and size checks). A change that
touches the public surface should say what changed and why in the description,
not only in the diff.

Use `.github/PULL_REQUEST_TEMPLATE.md` and fill in its checklist honestly. A box
that does not apply can be struck through with a reason; an unchecked box with
no explanation is treated as incomplete.

## Documentation

- User-facing behavior changes belong in `README.md` and/or `docs/`, in the same
  PR as the code.
- Security-relevant behavior changes belong in `docs/threat-model.md`, and in
  `SECURITY.md` when the policy itself changes.
- Releases are documented in `CHANGELOG.md`. A user-visible change should have a
  line ready for the next version section; the release process refuses to bump
  without a `## <version>` section. See the [release guide](docs/release.md).

## Releases

The procedure — preflight, changelog, prepare PR, publish, provenance, demo
deploy, and rollback — is in [docs/release.md](docs/release.md). Do not tag,
publish, or rewrite release history from a feature branch.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security
issues go through [SECURITY.md](SECURITY.md), never a public issue.
