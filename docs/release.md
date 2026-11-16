# Release guide

Releases are two-phase and mostly automated by `scripts/release.mjs`:

```bash
pnpm release:check          # read-only preflight
pnpm release:prepare 0.3.1  # bump, changelog, tests, PR, verify, merge
pnpm release:publish        # tag, npm publish, GitHub release, smoke test
```

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
## 0.3.1 — 2026-12-01

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
pnpm release:prepare 0.3.1    # add --dry-run to print the plan only
```

The script then, in order:

1. Verifies the version is greater than the current one and that the version,
   tag, and release are all absent.
2. Creates `chore/release-0.3.1`, bumps `package.json`, and **runs the local
   gate**: `pnpm typecheck`, `pnpm typecheck:core`, `pnpm test`, `pnpm build`,
   `pnpm demo:build`, `pnpm deploy:dry`.
3. Commits `chore(release): prepare 0.3.1`, pushes the branch, and opens a pull
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

`scripts/release.mjs` adds `--provenance` to `npm publish` only when all of that
is visible. In the normal local path none of it is, so the flag is omitted and
the script prints a note saying the publish is unsigned. npm itself refuses the
flag outside a supported CI — `EUSAGE: Automatic provenance generation not
supported for provider: undefined` — so passing it blindly would fail the
publish rather than degrade gracefully.

So: **releases published from a developer machine are not signed.** The code
path for a signed publish exists and is exercised whenever the script runs
inside GitHub Actions with `id-token: write`, but this repository ships no
publish workflow, so the supported procedure is the local one above. If you add
one, keep it `workflow_dispatch`-only, grant `id-token: write` (never a
long-lived `NODE_AUTH_TOKEN`), and publish from a commit that is already tagged —
do not let it tag, push, or merge on its own.

To check what a published version carries:

```bash
npm view @orozcoh/qr-stream@0.3.0 dist.attestations   # empty for a local publish
npm audit signatures                                   # in a consuming project
```

A missing attestation is not a vulnerability; it means "published from a
machine, not from a CI identity". Record that in the release notes if it
matters to your consumers.

## 6. Tag and GitHub release

`release:prepare` and `publish` create both, so normally there is nothing to do
by hand. If a publish failed after the tag was pushed, finish it manually rather
than re-tagging:

```bash
git tag -l v0.3.1                     # must point at HEAD
git rev-parse 'v0.3.1^{commit}'
gh release view v0.3.1 --repo orozcoh/qr-stream
```

Create a missing release from the changelog section:

```bash
gh release create v0.3.1 --repo orozcoh/qr-stream --title 0.3.1 --notes-file notes.md
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
npm deprecate '@orozcoh/qr-stream@0.3.1' 'Broken reader teardown; use 0.3.2'
```

**Point `latest` back at the last good version.** Deprecation does not stop a
fresh install of `@orozcoh/qr-stream` from resolving `latest`:

```bash
npm dist-tag add '@orozcoh/qr-stream@0.3.0' latest
npm view @orozcoh/qr-stream dist-tags
```

**Revert the tag and release only if the release itself is wrong** (wrong
commit, wrong notes, accidental publish). Deleting them does not delete the
tarball, and it breaks the link between an npm attestation and its ref:

```bash
gh release delete v0.3.1 --repo orozcoh/qr-stream --yes
git tag -d v0.3.1
git push origin :refs/tags/v0.3.1
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
- [ ] `pnpm release:publish --dry-run` prints the expected tag and version.
- [ ] The publish was either signed from CI (provenance) or explicitly noted as
      unsigned.
- [ ] The demo deploy for the merge commit succeeded, including the header and
      asset-hash assertions.
- [ ] The GitHub release body matches the changelog section.
- [ ] The registry smoke test imported the published entry.
