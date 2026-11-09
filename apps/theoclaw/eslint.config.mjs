import js from '@eslint/js'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The app's lint. The root config ignores `apps/**` (each app owns its lint), so this file is the
 * only analyzer that reads TheoClaw. Until B-664 it ignored `src/**` and `tests/**` too, and
 * `eslint tests/<file>` exited 0 having analysed nothing: "zero problems" and "nothing was checked"
 * print the same. `tests/eslint-reads-sources.test.ts` keeps both directories read.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['tools/**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  { files: ['tools/**/*.mjs'], ...sonarjs.configs.recommended },
  // Off for the reason the root config gives: it fires on the word, and the checker names the
  // vitest `.todo` modifier it refuses, which is not a task left undone.
  { files: ['tools/**/*.mjs'], rules: { 'sonarjs/todo-tag': 'off' } },
  // TypeScript sources and tests: the recommended sets, without type information, which measured
  // 16 errors on the tree when this block was added and none after they were fixed. A `_` prefix
  // marks a binding as deliberately unused, the convention the tree already follows (rest
  // destructuring that drops a key, a fake's parameters kept for the port's signature).
  ...tseslint.config({
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      // A `let` assigned once, after a closure that reads it was written, is a late binding and not
      // a constant: `startTheoClaw` declares the handles its shutdown hook reads before the
      // composition that produces them exists.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'all', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  }),
]
