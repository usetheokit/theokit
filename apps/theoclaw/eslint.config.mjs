import js from '@eslint/js'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'

/**
 * Lint for the app's Node scripts under `tools/`. The root config ignores `apps/**` (each app owns
 * its lint), and the TypeScript configs here read only `.ts`, so before this file the parity checker
 * and its test were read by no analyzer at all.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/**', 'tests/**'] },
  {
    files: ['tools/**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  { files: ['tools/**/*.mjs'], ...sonarjs.configs.recommended },
  // Off for the reason the root config gives: it fires on the word, and the checker names the
  // vitest `.todo` modifier it refuses, which is not a task left undone.
  { files: ['tools/**/*.mjs'], rules: { 'sonarjs/todo-tag': 'off' } },
]
