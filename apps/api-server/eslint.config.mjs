import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// This package had a `lint` script but no eslint dependency and no config, so the
// gate never actually ran. Rules below are deliberately conservative: enough to
// catch real mistakes without demanding a large refactor of existing code.
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.test.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    rules: {
      // Existing intentional patterns in this codebase, not defects:
      // lazy `require()` for optional/heavy deps, control characters in input
      // sanitisation regexes, and `self`-style aliasing.
      '@typescript-eslint/no-require-imports': 'off',
      'no-control-regex': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // `asyncHandler(fn: Function)` in the Express error middleware is deliberate.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // Escaping inside character classes, e.g. /[\[{]/, is redundant but clearer.
      'no-useless-escape': 'off',
      // Surfaced but non-blocking so the gate can be adopted incrementally.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  }
);
