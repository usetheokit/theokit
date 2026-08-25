import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  // `.theokit/` is build output — `theokit build` writes generated `.d.ts` there, and linting it
  // reports ~1800 style findings in code nobody wrote. A developer who adds a real error of their
  // own then cannot find it, which is the whole cost: not a broken build, a useless gate.
  //
  // ESLint flat config does NOT read `.gitignore`, so the one file that already knows what is
  // generated is not the file ESLint consults. `@eslint/compat`'s `includeIgnoreFile` would close
  // that permanently and is worth considering; this is the one-line version that works today.
  { ignores: ['dist/', 'node_modules/', '.theokit/'] },
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Declaration files carry TheoKit's module augmentations — `JobRegistry` in `types/jobs.d.ts`
    // is born EMPTY on purpose, for the app to fill in as it creates jobs. Without this exception, a
    // freshly scaffolded app fails its own `npm run lint` at minute zero (#93), and the first lesson
    // TheoKit teaches is that its gate lies.
    //
    // `allowInterfaces: 'always'` rather than disabling the rule: an empty interface is the canonical
    // form of declaration merging, but `type X = {}` is still flagged — and that one is a real error,
    // because `{}` accepts any non-null value, including `0` and `""`.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
    },
  },
)
