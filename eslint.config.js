import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Package boundaries (spec §8): core ← protocol, core ← ui, protocol ← ui, ui ← app.
// Rust is reached only through specs.json and the WASM exports.
const forbid = (...names) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: names.map((group) => ({
        group: [group, `${group}/*`],
        message: 'Crosses a package boundary.',
      })),
    },
  ],
});

export default tseslint.config(
  {
    ignores: [
      'docs/**',
      'target/**',
      'engine/pkg/**',
      '**/out/**',
      '**/dist/**',
      '**/node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
  {
    files: ['packages/core/**'],
    rules: forbid('@sreda/protocol', '@sreda/ui', '@sreda/app', 'solid-js', 'electron'),
  },
  { files: ['packages/protocol/**'], rules: forbid('@sreda/ui', '@sreda/app', 'solid-js', 'electron') },
  { files: ['packages/ui/**'], rules: forbid('@sreda/app', 'electron') },
);
