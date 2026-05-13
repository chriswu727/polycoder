// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'out/**',
      'release/**',
      // IST runner output: workspace snapshots are LLM-generated
      // browser code, not part of polycoder itself. They use globals
      // (document, localStorage, Chart) that our Node-targeted
      // config doesn't recognize.
      'benchmarks/ist/runs/**',
      'benchmarks/ist/metrics/polycoder-full/**',
      'benchmarks/ist/metrics/polycoder-coder-only/**',
      'benchmarks/ist/metrics/lovable/**',
      // CommonJS dev scripts (Node) — lint config is ESM-targeted.
      'scripts/**/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Surface unused values, but allow underscore-prefixed for intentional ignore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Per CLAUDE.md: don't introduce `any` casually.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow `// @ts-expect-error` with description.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      // Permit empty interfaces (used for branded types in Zod).
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
)
