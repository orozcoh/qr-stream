## Summary

<!-- What changes, and why. Link the issue if there is one. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change (public API, wire format, or supported runtime)
- [ ] Documentation or infrastructure only

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass locally.
- [ ] New behavior has a test that fails without this change (or an explanation
      of why a test is not feasible).
- [ ] `pnpm deps:check` passes; no import crosses a layer boundary.
- [ ] If the public API changed: `pnpm api:build` was run and the updated
      `etc/*.api.md` report is committed.
- [ ] If behavior is user-visible: `README.md` and/or `docs/` updated.
- [ ] If security-relevant: `docs/threat-model.md` (and `SECURITY.md` for policy)
      updated.
- [ ] If user-visible: a `CHANGELOG.md` line is ready for the next version, or
      the PR states why no entry is needed.
- [ ] If performance-sensitive: `pnpm bench:check` passes, or the budget change
      is intentional and explained.
- [ ] `pnpm check:package` and `pnpm check:size` pass (or were run and their
      output is attached).
- [ ] No secrets, tokens, credentials, camera captures, or real payloads are
      included.
- [ ] No new runtime dependency without a note on why it is unavoidable.

## Notes for reviewers

<!-- Trade-offs, known gaps, follow-up work, and anything you are unsure about. -->
