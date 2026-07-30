import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Arquivos de declaração carregam as augmentações de módulo do TheoKit — `JobRegistry` em
    // `types/jobs.d.ts` nasce VAZIA de propósito, para o app preencher conforme cria jobs. Sem esta
    // exceção, um app recém-scaffoldado reprova no próprio `npm run lint` no minuto zero (#93), e a
    // primeira lição que o TheoKit dá é que o gate dele mente.
    //
    // `allowInterfaces: 'always'` em vez de desligar a regra: interface vazia é a forma canônica de
    // declaration merging, mas `type X = {}` continua sendo acusado — e esse ainda é um erro de
    // verdade, porque `{}` aceita qualquer valor não-nulo, inclusive `0` e `""`.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
    },
  },
)
