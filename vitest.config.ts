import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // The React 18 runtime workspace has its own Vitest config and `.spec.tsx`
    // files, so the root suite neither runs nor resolves it.
    exclude: ['tests/react18-runtime/**'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Floor measured 2026-11-16 after the 1.0 RC fix wave: 93.91% lines,
      // 84.26% branches. The thresholds keep headroom below the measurement
      // while still blocking a real coverage regression.
      thresholds: {
        lines: 92,
        branches: 82,
      },
    },
  },
});
