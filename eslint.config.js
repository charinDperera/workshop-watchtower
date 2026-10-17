import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: [
      'dist/',
      '.astro/',
      'node_modules/',
      '.pnpm-store/',
      '.local/',
      'test-results/',
      'playwright-report/',
      'coverage/',
      'tests/fixtures/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs['flat/recommended'],
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // ADR-004 Order 3: client code never imports server code (src/server, scripts).
  {
    files: ['src/components/**', 'src/ui/**', 'src/layouts/**', 'src/shared/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server', '**/server/**', '**/scripts/**'],
              message: 'Client code may not import server code. Move shared types to src/shared.',
            },
          ],
        },
      ],
    },
  },
  // ADR-005: server code logs through the logger, never the console.
  {
    files: ['src/server/**', 'src/middleware.ts', 'scripts/**'],
    rules: { 'no-console': 'error' },
  },
  // ADR-006: only the config module reads the environment.
  {
    files: ['src/**'],
    ignores: ['src/server/config/env.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through src/server/config/env.ts.',
        },
      ],
    },
  },
]);
