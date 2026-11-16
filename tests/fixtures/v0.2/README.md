# Frozen 0.2.0 core

This directory is a verbatim copy of `src/core/` at commit `8f01790` (the 0.2.0
release), except for a `// @ts-nocheck` header on each TypeScript file. It is a
test fixture, not library source.

**Do not edit these files.** Their whole purpose is to prove that the current
wire format still interoperates with streams produced by an older release. A
change here would let the interop test pass against code that no one shipped.

The files are excluded from ESLint and Prettier so formatting churn cannot
modify the frozen copy. `interop.test.ts` exercises both directions:

- the frozen 0.2 reader reads a 1.0 writer stream (plain and encrypted);
- the 1.0 reader reads a frozen 0.2 writer stream (plain and encrypted);
- the 1.0 reader reconstructs `golden.json`, whose packets were emitted by the
  frozen 0.2 writer.

Regenerate `golden.json` only by running the frozen writer, never by hand.
