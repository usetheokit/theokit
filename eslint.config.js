// ESLint flat config — quality gate (strict from day 1).
//
// Stack: typescript-eslint v8 + ESLint v9 + React 19. Rules selected to
// catch real bugs, not stylistic preferences (Prettier owns style). See
// CLAUDE.md "PARTE I — Regras de conduta" for the engineering principles.
//
// Severity policy:
//   - "error" for bug-producing patterns (no-floating-promises, no-misused-promises, etc).
//   - "warn" for code smells that need human judgment (complexity, max-lines).
//   - "off" for noisy stylistic rules (handled by Prettier or out of scope).

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import importPlugin from 'eslint-plugin-import'
import nodePlugin from 'eslint-plugin-n'
import promisePlugin from 'eslint-plugin-promise'
import securityPlugin from 'eslint-plugin-security'
import sonarjsPlugin from 'eslint-plugin-sonarjs'
import unicornPlugin from 'eslint-plugin-unicorn'
import unusedImportsPlugin from 'eslint-plugin-unused-imports'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  // Ignored paths (replaces .eslintignore in flat config).
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.theokit/**',
      '**/coverage/**',
      '**/test-results/**',
      'referencias/**',
      // Zona de estudo: clones de projetos de terceiros, lidos para aprender e nunca editados.
      // Medido em agent-builder#119: `.claude/knowledge-base/references/next.js` sozinho custava
      // 264 s dos 867 s do lint — 30% do tempo total gasto lintando código que não é nosso e que
      // ninguém pode consertar aqui.
      '.claude/knowledge-base/references/**',
      '.claude/worktrees/**',
      'pnpm-lock.yaml',
      'fixtures/**/dist/**',
      'examples/**/dist/**',
      'my-test/**',
      // Worktrees created by agent runtimes are sandboxes with their own
      // checkout state and possibly stale TS project graphs. They are not
      // shipping code; linting them inflates error counts and breaks the
      // type-checked parser (no projectService entry).
      '.claude/worktrees/**',
      // create-theo `templates/` are pristine scaffold blueprints that get
      // copied into the user's project. They are NOT framework code; they
      // exist as didactic starting points. Lint-checking them creates
      // confusing reports (the user will write their own version anyway)
      // and would break with every minor scaffold-style change.
      'packages/create-theo/templates/**',
      'packages/create-theokit/templates/**',
      // Fixtures + examples have their own per-folder tsconfig that the
      // root project service does not own. They are end-user demo apps,
      // not framework code; linting them produces parser-only errors that
      // do not represent real issues in the shipping framework surface.
      'fixtures/**',
      'examples/**',
      // http-decorators tests + config use experimentalDecorators tsconfig
      // that the root parser projectService cannot resolve. Tests are
      // covered by vitest; config files are trivial. Lint the src/ only.
      'packages/http-decorators/tests/**',
      // `packages/*/examples/**` e não `packages/http-decorators/examples/**`: a razão acima vale
      // para os examples de QUALQUER pacote, e enumerar um por um falha por omissão — foi assim que
      // `packages/http/examples/**` ficou de fora e produziu 3 erros de PARSER
      // (`was not found by the project service`), invisíveis até o lint voltar a terminar
      // (agent-builder#119).
      'packages/*/examples/**',
      'packages/http-decorators/vitest.config.ts',
      'packages/http-decorators/tsup.config.ts',
      'packages/http/tsup.config.ts',
      'packages/agents/tsup.config.ts',
      'packages/presenter/tsup.config.ts',
      'packages/presenter/vitest.config.ts',
      'packages/agents/vitest.config.ts',
      'packages/http/vitest.config.ts',
      'packages/agents/vitest.live.config.ts',
    ],
  },

  // Base JS recommended.
  js.configs.recommended,

  // TypeScript strict + type-checked.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // SonarJS (code smells).
  sonarjsPlugin.configs.recommended,

  // `todo-tag`, desligada em TODA extensão — agent-builder#120.
  //
  // A regra casa a palavra "TODO" em qualquer caixa, e "todo" é palavra comum do português,
  // presente na prosa explicativa deste repositório. Ela derrubou o build TRÊS vezes no M95 por
  // texto legítimo ("para todo erro", "todo turno", "todo estado"), e consertar palavra por palavra
  // só adia a próxima. Medido na revisão: marcadores REAIS no fonte da camada → 0. Zero verdadeiros
  // positivos contra três falsos é custo permanente com benefício nulo.
  //
  // Estava só no bloco `files: ['**/*.{ts,tsx,mts,cts}']`, e por isso NÃO alcançava `.js` — o
  // próprio `eslint.config.js` reprovava, três vezes, no comentário que explicava o desligamento.
  // Ninguém tinha visto porque `npm run lint` não terminava (#119); o primeiro veredito do lint por
  // grupo foi este. Sem `files`, o bloco vale para tudo, que é o que a decisão sempre quis dizer.
  //
  // O sinal que a regra dava não foi abandonado: `tests/lint/task-marker.test.ts` casa a
  // forma que um marcador de verdade tem — MAIÚSCULA + dois-pontos, dentro de comentário — e
  // ignora a palavra solta. Gate, não convenção.
  {
    rules: { 'sonarjs/todo-tag': 'off' },
  },

  // Project-wide language options.
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // Plugins + rules for TS/TSX sources.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      import: importPlugin,
      n: nodePlugin,
      promise: promisePlugin,
      security: securityPlugin,
      unicorn: unicornPlugin,
      'unused-imports': unusedImportsPlugin,
    },
    settings: {
      react: { version: '19.0' },
      'import/resolver': {
        typescript: {
          project: ['tsconfig.json', 'packages/*/tsconfig.json', 'packages/*/tsconfig.test.json'],
        },
        node: true,
      },
    },
    rules: {
      // --- Real-bug catchers (errors) ---
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      // `restrict-template-expressions` policy: stop `${obj}` and `${arr}`
      // (the `[object Object]` foot-gun is real) but accept primitives in
      // template strings. `${42}` → "42" is safe behavior, not a smell.
      // The dangerous case is still caught by `no-base-to-string`.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true, allowRegExp: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],

      // Promises — fail loud, never silently swallow.
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': 'error',
      'promise/no-nesting': 'warn',

      // Security — defense in depth at the lint layer.
      'security/detect-object-injection': 'off', // too noisy for TS, type system already catches the real ones
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-new-buffer': 'error',

      // React.
      'react/jsx-uses-react': 'off', // React 19 / jsx-runtime
      'react/react-in-jsx-scope': 'off',
      'react/jsx-key': 'error',
      'react/no-unescaped-entities': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // Imports — no cycles, no extraneous.
      'import/no-cycle': ['error', { maxDepth: 5, ignoreExternal: true }],
      'import/no-self-import': 'error',
      'import/no-useless-path-segments': 'error',
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-default-export': 'off',

      // Code-smell guards (warn — human judgment).
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-collapsible-if': 'warn',
      'sonarjs/no-redundant-jump': 'warn',
      'sonarjs/no-small-switch': 'off',
      // Ver o bloco `sonarjs/todo-tag` mais abaixo — o desligamento é global, não só-TS.
      // Duplicate rules — already covered by other plugins, surfaced once
      // is enough (turning off the duplicate is not a bypass; it removes
      // the redundant report). The "kept" rule is named in the comment.
      'sonarjs/unused-import': 'off', // kept: unused-imports/no-unused-imports
      'sonarjs/no-unused-vars': 'off', // kept: unused-imports/no-unused-vars
      'sonarjs/prefer-regexp-exec': 'off', // kept: @typescript-eslint/prefer-regexp-exec
      'sonarjs/no-nested-functions': 'off', // overlaps with complexity + max-lines-per-function
      'sonarjs/different-types-comparison': 'off', // overlaps with @typescript-eslint/no-unnecessary-condition

      // Complexity ceilings (warn — refactor signal, not block).
      complexity: ['warn', { max: 15 }],
      'max-depth': ['warn', 4],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 120, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-params': ['warn', 5],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Unicorn — surgical (most opinionated rules off; only bug-shaped ones on).
      'unicorn/error-message': 'error',
      'unicorn/no-array-push-push': 'warn',
      'unicorn/no-instanceof-array': 'error',
      'unicorn/no-new-array': 'error',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-set-has': 'warn',
      'unicorn/throw-new-error': 'error',
      'unicorn/no-await-in-promise-methods': 'error',
      'unicorn/no-single-promise-in-promise-methods': 'error',
    },
  },

  // Type-only tests (`*.test-d.ts`) — assertions are `expectTypeOf<...>()`
  // which sonarjs does not recognize as a test assertion. The TS compiler
  // is the actual checker for these files (`tsc --noEmit` is the gate).
  {
    files: ['**/*.test-d.{ts,tsx}'],
    rules: {
      'sonarjs/assertions-in-tests': 'off',
    },
  },

  // Test files — relaxed (test code is documentation, not production).
  {
    // `**/*.bench.{ts,tsx}` entrou em agent-builder#319: um benchmark do vitest é código de teste
    // pela mesma razão que um `.test.ts` — ele não embarca, e mede em vez de afirmar. Sem ele,
    // `packages/agents/tests/bench/guardrails.bench.ts` era o ÚNICO arquivo de teste do repositório
    // sob regra de produção, e pagava 5 avisos de `no-non-null-assertion` pelo idioma normal de
    // teste. Só o padrão de bench foi acrescentado: `tests/**` NÃO virou `**/tests/**`, porque os
    // testes dentro de `packages/*` passam nas regras de produção hoje, e alargar a relaxação para
    // eles esconderia achados sem que ninguém tivesse pedido.
    files: [
      'tests/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/*.test-d.{ts,tsx}',
      '**/*.bench.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/no-identical-functions': 'off',
      'sonarjs/prefer-regexp-exec': 'off',
      'sonarjs/deprecation': 'off',
      'sonarjs/no-collapsible-if': 'off',
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/no-dead-store': 'off',
      'sonarjs/publicly-writable-directories': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-depth': 'off',
      'max-params': 'off',
      complexity: 'off',
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-child-process': 'off',
      'security/detect-non-literal-regexp': 'off',
      'import/order': 'off',
      'promise/param-names': 'off',
      'promise/catch-or-return': 'off',
      'unicorn/no-array-push-push': 'off',
      'unicorn/no-await-in-promise-methods': 'off',
    },
  },

  // Fixtures — these are scaffold TEMPLATES, not framework code. Apply
  // ergonomic rules only; everything else is irrelevant to user-facing
  // scaffold quality (and many warnings actually exist as didactic
  // examples of what apps may do).
  {
    files: ['fixtures/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}', 'my-test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/array-type': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/deprecation': 'off',
      'sonarjs/no-collapsible-if': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-params': 'off',
      'max-depth': 'off',
      complexity: 'off',
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-child-process': 'off',
      'security/detect-non-literal-regexp': 'off',
      'import/order': 'off',
    },
  },

  // Scripts / config files (Node-only, less strict typing).
  {
    files: [
      '**/*.config.{ts,mts,cts,js,mjs,cjs}',
      'scripts/**/*.{ts,js,mjs}',
      // M90 — só `packages/*/scripts/**`, e só por causa de `generate-reexports.mts`. A primeira versão
      // ampliou `scripts/**` para `.mts` também, e a revisão mediu o excesso: relaxava
      // `no-explicit-any`/`no-unsafe-*` em `scripts/preflight-native-bindings.d.mts` e
      // `scripts/sync-template-versions.d.mts`, que não pediram nada.
      'packages/*/scripts/**/*.{ts,mts,js,mjs}',
      '**/tsup.config.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-child-process': 'off',
    },
  },

  // @theokit/http — CONTROLLER decorator metadata bridge requires `Function` type,
  // `any` from reflect-metadata returns (Reflect.getMetadata returns `any` per spec), and
  // single-use type parameters. Inherent to the decorator/reflect-metadata pattern, not bugs.
  // M53: `packages/agents` was REMOVED from this list — it no longer uses reflect-metadata, so
  // the exemption had no reason to exist there.
  {
    files: ['packages/http-decorators/src/**/*.ts', 'packages/http/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },

  // CLI commands — `console.log` IS the output of the program. Disabling
  // `no-console` here is not a bypass; the rule exists to keep stray
  // debug prints out of business logic, which is irrelevant in a CLI
  // tool whose stdout/stderr is its user interface.
  {
    files: [
      'packages/theo/src/cli/**/*.ts',
      'packages/create-theo/src/cli.ts',
      'packages/create-theo/src/index.ts',
      'packages/create-theokit/src/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
      // CLI reads JSON files (package.json, tsconfig.json) via JSON.parse
      // which returns `any`. This is safe — the CLI validates shape at runtime.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // CLI scaffolder creates files from user-provided paths by design
      'security/detect-non-literal-fs-filename': 'off',
      // CLI runs child processes by design (pnpm install, git init)
      'sonarjs/os-command': 'off',
      'sonarjs/no-os-command-from-path': 'off',
      'security/detect-child-process': 'off',
      // CLI main() orchestrates many steps — complexity is inherent, not a smell
      complexity: 'off',
      'sonarjs/cognitive-complexity': 'off',
    },
  },

  // JS files (no type-checking).
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Prettier compat (must be last — disables formatting rules).
  prettierConfig,
)
