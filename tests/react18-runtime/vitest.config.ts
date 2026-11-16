import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

// The built `dist/react.js` lives at the repository root, so a bare `react`
// import from inside it resolves the root React 19 install. Alias every React
// entry point to this workspace's own React 18 so the test proves the built
// package on the runtime it claims to support.
const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react$/, replacement: require.resolve('react') },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve('react/jsx-dev-runtime') },
      { find: /^react-dom$/, replacement: require.resolve('react-dom') },
      { find: /^react-dom\/client$/, replacement: require.resolve('react-dom/client') },
      { find: /^react-dom\/server$/, replacement: require.resolve('react-dom/server') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['*.spec.tsx'],
  },
});
