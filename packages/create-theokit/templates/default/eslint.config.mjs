import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import drizzle from 'eslint-plugin-drizzle'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'drizzle/'] },
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: { drizzle },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'drizzle/enforce-delete-with-where': 'error',
      'drizzle/enforce-update-with-where': 'error',
    },
  },
)
