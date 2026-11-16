import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'demo/dist/**',
      'examples/dist/**',
      'coverage/**',
      'node_modules/**',
      'docs/**',
      // Frozen 0.2.0 test fixture; formatting must not churn it.
      'tests/fixtures/v0.2/capacity.ts',
      'tests/fixtures/v0.2/compress.ts',
      'tests/fixtures/v0.2/crc32.ts',
      'tests/fixtures/v0.2/crypto.ts',
      'tests/fixtures/v0.2/fountain.ts',
      'tests/fixtures/v0.2/meta.ts',
      'tests/fixtures/v0.2/packet.ts',
      'tests/fixtures/v0.2/prng.ts',
      'tests/fixtures/v0.2/reader.ts',
      'tests/fixtures/v0.2/types.ts',
      'tests/fixtures/v0.2/writer.ts',
    ],
  },
  {
    // Node-context files (config, scripts) run outside the browser.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      'import/no-cycle': 'error',
      'import/order': [
        'error',
        {
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'demo/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // The core is environment-agnostic and must stay that way. This replaces
    // the retired purity test's global guard: browser access belongs in
    // src/browser, and host DOM types must not leak into the core.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core must not touch the DOM; use src/browser.' },
        { name: 'document', message: 'src/core must not touch the DOM; use src/browser.' },
        { name: 'navigator', message: 'src/core must not touch the DOM; use src/browser.' },
        { name: 'localStorage', message: 'src/core must not touch storage; use src/browser.' },
        { name: 'requestAnimationFrame', message: 'src/core must not schedule frames; use src/browser.' },
      ],
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            HTMLElement: { message: 'src/core must not reference DOM element types; use src/browser.' },
            HTMLCanvasElement: { message: 'src/core must not reference DOM element types; use src/browser.' },
            HTMLVideoElement: { message: 'src/core must not reference DOM element types; use src/browser.' },
            MediaStream: { message: 'src/core must not reference media types; use src/browser.' },
            Window: { message: 'src/core must not reference the window type; use src/browser.' },
            Document: { message: 'src/core must not reference the document type; use src/browser.' },
          },
        },
      ],
    },
  },
  {
    files: ['tests/react18-runtime/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tests/react18-runtime/tsconfig.json',
        tsconfigRootDir: rootDir,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  prettier,
);
