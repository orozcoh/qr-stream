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
