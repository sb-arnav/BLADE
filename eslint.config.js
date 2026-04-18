// eslint.config.js — ESLint 9 flat config (D-34)
//
// Wires the project-local `blade/no-raw-tauri` rule (eslint-rules/no-raw-tauri.js)
// as a custom plugin. No other rules are enabled in Phase 1 — Phase 9 Polish
// Pass can layer on @typescript-eslint + react-hooks configs once the feature
// surface stabilises. Today the only invariant we CI-enforce is D-34.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-34
// @see eslint-rules/no-raw-tauri.js

import noRawTauri from './eslint-rules/no-raw-tauri.js';

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
    },
    rules: {
      'blade/no-raw-tauri': 'error',
    },
  },
];
