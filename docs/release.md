# Release guide

Releases are two-phase. `scripts/release.mjs` owns the version bump, the PR, the
tag, the GitHub release, and the smoke test:

```bash
pnpm release:check          # read-only preflight
pnpm release:prepare 1.0.1  # bump, changelog, tests, PR, verify, merge
pnpm release:publish        # tag, npm publish, GitHub release, smoke test
```

Signed npm provenance comes from a separate `workflow_dispatch` job,
[`publish.yml`](../.github/workflows/publish.yml); a local `release:publish`
upload is unsigned. See [Publish](#5-publish) for which path to use.

`release:prepare` and `release:publish` both refuse to run unless the current
branch is `main`, the worktree is clean, local `main` matches `origin/main`,
`gh` is authenticated as the repository owner, and `npm whoami` succeeds. The
guard is the point: a release from a dirty worktree or a stale clone is how a
tag ends up on the wrong commit.

## Prerequisites

- Node 20 or newer, pnpm 11 (the version CI uses), and a clean `main` equal to
  `origin/main`.
- `gh auth login` as the account that owns `orozcoh/qr-stream`. The script
  fails if the active account is a collaborator or a different user.
- `npm login` with publish rights on `@orozcoh`. For a 2FA account, either
  export `NPM_OTP` for the publish step or answer the prompt.
- The `production` environment and its Cloudflare secrets exist, because
  `release:prepare` waits for the `deploy.yml` run that follows the merge. See
  [Deploy prerequisites](../README.md#prerequisites-once).
- No pending `CHANGELOG.md` edits other than the section for the version you are
  releasing; `prepare` allows that one file to be dirty on purpose.

## Versioning

Semantic versioning, with the usual `0.x` caveat: a minor bump may contain a
breaking change, and the changelog must say so. The supported line is documented
in [SECURITY.md](../SECURITY.md); a security patch goes out as a patch release on
the current minor, not as a new minor.

Pre-releases (`1.0.0-rc.1`) are published with `dist_tag=next` and must never
move `latest`; the GitHub release is marked **pre-release**, not Latest. The
final `1.0.0` publish is the first one that moves `latest`.

The wire format is the compatibility boundary, not the package version. A change
to packet, metadata, or fountain encoding needs a wire-version bump and an
interop note in the changelog — the 0.2 fixture tests in `tests/fixtures/v0.2/`
are what prove the old reader still works.

## 1. Preflight

```bash
pnpm release:check
```

This is read-only and prints, before it fails on anything:

- branch, worktree state, and whether `main` matches `origin/main`;
- the current `package.json` version;
- whether `CHANGELOG.md` has a `## <version>` section for it;
- whether that version is already on npm, whether the tag exists locally or on
  the remote, and whether a GitHub release exists.

Resolve anything unexpected now. `release:publish` refuses an already-published
version, a tag that points somewhere other than `HEAD`, and an existing release
unless you pass `--resume` (or `--update-release` for the notes).

## 2. Version and changelog

Choose the next version and write its changelog section **before** preparing:

```markdown
## 1.0.1 — 2026-12-01

### Fixed

- ...
```

`release:prepare` requires that section and refuses to bump without it. Writing
it on `main` and leaving it uncommitted is the intended flow: `prepare` includes
the changelog in the release commit, so the bump and the notes pass `verify` in
the same pull request.

Keep entries user-facing. "Fixed a race in `useCameraReader` teardown" is useful;
"refactored `camera.ts`" is not. Call out breaking changes, wire-format changes,
and security fixes explicitly.

## 3. Prepare

```bash
pnpm release:prepare 1.0.1    # add --dry-run to print the plan only
```

The script then, in order:

1. Verifies the version is greater than the current one and that the version,
   tag, and release are all absent.
2. Creates `chore/release-1.0.1`, bumps `package.json`, and **runs the local
   gate**: `pnpm typecheck`, `pnpm typecheck:core`, `pnpm test`, `pnpm build`,
   `pnpm demo:build`, `pnpm deploy:dry`.
3. Commits `chore(release): prepare 1.0.1`, pushes the branch, and opens a pull
   request whose body is the changelog section.
4. Waits for `verify` on that PR (`gh pr checks --watch`), asks for confirmation,
   merges, returns to `main`, pulls, and deletes the branch.
5. Waits for the `deploy.yml` run for the merge commit. If GitHub missed the
   push event, it dispatches `deploy.yml` from `main` instead of skipping the
   check silently.

If a step fails after the branch exists, fix the cause and rerun with `--resume`
so the existing branch is reused.

## 4. The full gate

`release:prepare` runs the fast local subset. CI runs the authoritative list in
`.github/workflows/verify.yml`; a release should be green on all of it:

| Check | Command |
| --- | --- |
| Lint, dependency rules, format | `pnpm lint && pnpm deps:check && pnpm format:check` |
| Types | `pnpm typecheck && pnpm typecheck:core && pnpm typecheck:react18` |
| Unit, fuzz, coverage | `pnpm test && FUZZ_RUNS=1000 pnpm test:fuzz && pnpm test:coverage` |
| Build | `pnpm build && pnpm demo:build && pnpm examples:build && pnpm docs:build` |
| Public API | `pnpm api:check` |
| React 18 runtime | `pnpm --filter @orozcoh/qr-stream-react18 typecheck && pnpm --filter @orozcoh/qr-stream-react18 test` |
| Package shape and size | `pnpm check:package && pnpm check:size` |
| Budgets | `pnpm bench:check` |
| Browser end-to-end | `pnpm test:e2e` |

`test:e2e` needs Chromium once: `pnpm exec playwright install --with-deps chromium`.
Running the full gate locally before `prepare` is optional but cheap compared to
a failed publish.

## 5. Publish

Two publishers are supported. Use the CI workflow when you want a signed
provenance attestation; use the local script when CI is unavailable or the npm
publish already happened. Both need the changelog section from step 2 and a
green gate, and neither creates a release note you have not written.

### 5a. CI publish — the provenance path

`.github/workflows/publish.yml` is the only path that produces signed npm
provenance. It is `workflow_dispatch` only, refuses any ref except `main`, and
refuses a version that does not match both `package.json` and `CHANGELOG.md`.

One-time setup:

- Create a repository secret `NPM_TOKEN`: an npm automation token with publish
  rights on `@orozcoh`. It authenticates the upload; it does not sign anything.
- Leave the workflow's `permissions` alone: `contents: read` plus
  `id-token: write`. The OIDC token, not the npm token, is what Sigstore uses to
  attest the tarball.
- If you would rather not store a token, configure npm trusted publishing for
  this repository, then **also** remove two things: the `NODE_AUTH_TOKEN`
  environment line from the publish step, and `registry-url:
  https://registry.npmjs.org` from the `setup-node` step. `setup-node` writes
  `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into `.npmrc` whenever
  `registry-url` is set; with no token that entry sends an empty credential and
  npm fails `E401` before it ever attempts the OIDC exchange. Trusted publishing
  needs no `_authToken` line at all. The `id-token: write` permission is
  required either way.
- Trusted publishing requires **npm >= 11.5.1 (Node >= 22.14)**. The workflow
  pins `node-version: 22`, whose bundled npm is older than that, so add
  `npm install -g npm@latest` before the publish step, or invoke
  `npx npm@latest publish ...`. Without a current npm the OIDC exchange is not
  attempted and the publish fails before any upload.

`dry_run` defaults to **true**, so the first dispatch packs and reports without
uploading:

```bash
gh workflow run publish.yml --repo orozcoh/qr-stream --ref main \
  -f version=1.0.1 -f dist_tag=latest -f dry_run=true
gh run watch --repo orozcoh/qr-stream
```

When the dry run is green, dispatch again with `-f dry_run=false`. The job runs,
in order: frozen install, branch/version/changelog check, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm api:check`,
`pnpm check:package`, then

```bash
npm publish --provenance --access public --tag <dist_tag>
```

For the `1.0.0-rc.1` release candidate, use the `next` dist-tag:

```bash
gh workflow run publish.yml --repo orozcoh/qr-stream --ref main \
  -f version=1.0.0-rc.1 -f dist_tag=next -f dry_run=true
gh run watch --repo orozcoh/qr-stream
# green dry run, then the real upload:
gh workflow run publish.yml --repo orozcoh/qr-stream --ref main \
  -f version=1.0.0-rc.1 -f dist_tag=next -f dry_run=false
```

After any publish, assert the dist-tags before treating the release as done:

```bash
npm view @orozcoh/qr-stream dist-tags
# expect, for the RC:
# next:   1.0.0-rc.1
# latest: 0.2.0
```

If `latest` moved, put it back and re-check:

```bash
npm dist-tag add '@orozcoh/qr-stream@0.2.0' latest
npm view @orozcoh/qr-stream dist-tags
```

It does **not** tag, push, or create a GitHub release. Tags and release notes
stay with `scripts/release.mjs`, which knows how to check that `main` is clean
and synced and refuses a tag that points elsewhere. After a successful CI
publish, finish locally from the same commit:

```bash
pnpm release:check
pnpm release:publish --resume   # skips npm (already published), tags, releases, smoke-tests
```

`--resume` is what makes this safe: the script sees the version on npm, skips
the upload, and still creates the annotated tag and the GitHub release. It still
requires `npm whoami` to succeed, so `npm login` first even though nothing is
uploaded.

`scripts/release.mjs` creates an ordinary GitHub release, so mark an RC as a
pre-release afterwards (or pass these flags to the equivalent `gh release
create` when creating it by hand):

```bash
gh release edit v1.0.0-rc.1 --repo orozcoh/qr-stream --prerelease --latest=false
gh release view v1.0.0-rc.1 --repo orozcoh/qr-stream   # "Pre-release", not "Latest"
```

### 5b. Local publish — unsigned

```bash
pnpm release:publish --dry-run   # prints the plan, changes nothing
pnpm release:publish
```

What it does:

1. Re-checks `main`, the version, the changelog section, the tag, npm, and the
   GitHub release.
2. Waits for the deploy of `HEAD` (`--skip-deploy-check` to bypass).
3. Runs `pnpm test` and `pnpm typecheck` unless `--skip-checks` is passed.
4. Creates and pushes the annotated tag `v<version>`.
5. Runs `npm publish` with `--tag <dist-tag>` when it is not `latest`.
6. Waits until the registry reports the version, then creates or updates the
   GitHub release from the changelog section.
7. Installs the published package into an empty temporary directory and imports
   the root entry. `--no-smoke` skips that; do not skip it for a real release.

Useful flags: `--yes` (skip confirmations), `NPM_OTP=123456` for a 2FA account
(passed to npm as `--otp`), `--tag next` for a prerelease dist-tag, `--resume`
after a partial publish, `--update-release` to refresh the notes.

A local publish is **unsigned**. There is no OIDC identity on a laptop, so
`scripts/release.mjs` omits `--provenance` and prints
`provenance: skipped — …`. npm itself refuses the flag outside a supported CI
(`EUSAGE: Automatic provenance generation not supported for provider: undefined`),
so passing it would fail the publish rather than degrade gracefully.

### Provenance

npm provenance is a signed attestation that links the published tarball to the
workflow run, commit, and repository that produced it. npm only generates it on
a supported cloud CI provider with a cloud-hosted runner; this repository uses
GitHub Actions, which additionally requires:

- the runner to set `GITHUB_ACTIONS=true`;
- `permissions: id-token: write` on the job, so
  `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` are present;
- the public `repository` field in `package.json` to match the GitHub repository
  (case-sensitive).

`publish.yml` satisfies all three and passes `--provenance` on every real
publish. A green dry run proves the pack, version, and tag arguments — not the
signature and not the token; npm makes no registry request under `--dry-run`, so
auth is first exercised on the real run. `scripts/release.mjs` adds the flag
only when the same conditions are visible; locally none are, so it publishes
unsigned and says so.

To check what a published version carries:

```bash
npm view @orozcoh/qr-stream@1.0.0-rc.1 dist.attestations   # empty for a local publish
npm audit signatures                                   # in a consuming project
```

A missing attestation is not a vulnerability; it means "published from a
machine, not from a CI identity". Record that in the release notes if it
matters to your consumers. If the `publish.yml` run itself fails at
`npm publish`, the attestation was never created — the registry has no partial
state to clean up, because npm uploads and attestation are one request.

## 6. Tag and GitHub release

`release:prepare` and a local `release:publish` create both, and after a CI
publish `pnpm release:publish --resume` creates them, so normally there is
nothing to do by hand. If a publish failed after the tag was pushed, finish it
manually rather than re-tagging:

```bash
git tag -l v1.0.1                     # must point at HEAD
git rev-parse 'v1.0.1^{commit}'
gh release view v1.0.1 --repo orozcoh/qr-stream
```

Create a missing release from the changelog section:

```bash
gh release create v1.0.1 --repo orozcoh/qr-stream --title 1.0.1 --notes-file notes.md
```

The release body is the `## <version>` section verbatim. Do not move an existing
tag; npm provenance and the release both reference the commit, and a moved tag
turns a verifiable release into an unverifiable one.

## 7. Demo deploy

The demo is not published to npm. It deploys from `main`:

- pushing the release merge to `main` triggers `.github/workflows/deploy.yml`,
  which re-runs verification, deploys the built assets with the lockfile-pinned
  Wrangler, and then asserts the live origin: HTTP 200 for `/`, `sw.js`,
  `manifest.webmanifest`, and `icon.svg`, plus `Permissions-Policy:
  camera=(self)`, a CSP, HSTS, and the asset hash in the served `index.html`.
- `release:prepare` waits for that run, so a green deploy is part of preparing,
  not a separate afterthought.
- To deploy by hand: `pnpm demo:build && pnpm deploy:dry && pnpm deploy` with
  Cloudflare credentials in the environment. `deploy:dry` validates config and
  asset resolution without uploading.

There are no preview deployments. Each deploy replaces the previous version, so
only one version is ever live.

## 8. Rollback

Nothing here rewrites a published version. npm versions are immutable, and a
tarball that has been installed by anyone should be treated as permanent.

**Deprecate the bad version.** This is the first action and it is reversible:

```bash
npm deprecate '@orozcoh/qr-stream@1.0.1' 'Broken reader teardown; use 1.0.2'
```

**Point `latest` back at the last good version.** Deprecation does not stop a
fresh install of `@orozcoh/qr-stream` from resolving `latest`:

```bash
npm dist-tag add '@orozcoh/qr-stream@0.2.0' latest
npm view @orozcoh/qr-stream dist-tags
```

**Revert the tag and release only if the release itself is wrong** (wrong
commit, wrong notes, accidental publish). Deleting them does not delete the
tarball, and it breaks the link between an npm attestation and its ref:

```bash
gh release delete v1.0.1 --repo orozcoh/qr-stream --yes
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
```

**Redeploy the previous site.** `deploy.yml` runs on pushes to `main`, so the
supported path is a revert commit through a pull request, which redeploys the
previous build and leaves an auditable history:

```bash
git revert --no-edit <merge-sha>
```

Pushing a rollback commit directly to `main` is not allowed by the ruleset, and
`wrangler rollback` is a manual escape hatch that leaves `main` and the live site
disagreeing — use it only to stop an active incident, then revert `main` to
match.

**Ship a fix as a new patch.** Once a version is deprecated and `latest` is
moved, the next release is the normal flow again: changelog, `prepare`, publish.
Do not reuse the rolled-back version number.

## 9. Release checklist

- [ ] `pnpm release:check` passes on an up-to-date `main`.
- [ ] `CHANGELOG.md` has a non-empty `## <version>` section.
- [ ] Breaking changes, wire-format changes, and security fixes are called out.
- [ ] The full gate is green (at minimum, the subset `prepare` runs plus
      `check:package` and `api:check`).
- [ ] `publish.yml` ran with `dry_run=true` and reported the expected version,
      then again with `dry_run=false` (or the local `pnpm release:publish
      --dry-run` printed the expected tag and version for an unsigned publish).
- [ ] The publish was signed by `publish.yml` (provenance present) or is
      explicitly recorded as an unsigned local publish.
- [ ] `pnpm release:publish --resume` created the tag and GitHub release after a
      CI publish (it skips the already-uploaded npm step).
- [ ] For a pre-release, `npm view @orozcoh/qr-stream dist-tags` shows
      `next: <version>` and `latest` unchanged, and the GitHub release is marked
      pre-release rather than Latest.
- [ ] The demo deploy for the merge commit succeeded, including the header and
      asset-hash assertions.
- [ ] The GitHub release body matches the changelog section.
- [ ] The registry smoke test imported the published entry.
