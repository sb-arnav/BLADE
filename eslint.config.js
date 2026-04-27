// eslint.config.js — ESLint 9 flat config (D-34)
//
// Wires the project-local `blade/no-raw-tauri` rule (eslint-rules/no-raw-tauri.js)
// plus a TypeScript parser and the react-hooks / jsx-a11y plugins so inline
// eslint-disable comments referencing their rules resolve. The rules are not
// enabled at the config level — D-34 remains the only CI-enforced invariant —
// but the plugins must be registered for the inline disables to validate.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-34
// @see eslint-rules/no-raw-tauri.js

import noRawTauri from './eslint-rules/no-raw-tauri.js';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      'src.bak/**',
      'tests/**',
      'scripts/**',
      'eslint-rules/**',
      'eslint.config.js',
      'playwright.config.ts',
      'vite.config.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      blade: {
        rules: {
          'no-raw-tauri': noRawTauri,
        },
      },
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      'blade/no-raw-tauri': 'error',
    },
  },
];
