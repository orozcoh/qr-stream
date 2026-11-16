import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Baseline floor measured 2026-11-16: 76.17% lines, 61.01% branches.
      // Raise toward 80% before the 1.0 release.
      thresholds: {
        lines: 76,
        branches: 61,
      },
    },
  },
});
