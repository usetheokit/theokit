import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * The rules that hold the shape of the code, without the historical debt notes of the repository
 * this code came from. Every cap below measured ZERO violations on this tree when it was set, so
 * each one freezes a good state instead of announcing debt.
 */
export default tseslint.config(
  // `deadcode-output/` is the loop-deadcode-audit plugin's working directory (gitignored, like
  // `code-review-output`). Its scripts are throwaway analysis tooling, not project source.
  // `codex/` is the OpenAI Codex study clone (99 MB, Apache-2.0), kept on disk as the reference the
  // parity work is measured against and gitignored so it can never be committed. ESLint does not
  // read `.gitignore`, and from v10 it descends here and tries to LOAD `codex/sdk/typescript/
  // eslint.config.js` — a foreign config with plugins this repository does not install, which
  // aborted the whole lint run with ERR_MODULE_NOT_FOUND before a single file of ours was checked.
  // `.claude/**` joins the list for the same reason `node_modules/**` is on it: it is an INSTALLED
  // DEPENDENCY, not this project's source. It is gitignored (`.gitignore:23`), so nothing found in
  // it can be committed here — a fix belongs in the kit's own repository.
  //
  // Measured 2026-09-15, in the spirit of #39 below rather than assumed: `npx eslint .claude
  // --no-ignore` reports 45 errors, and every one is `no-undef` on `args`, `log`, `agent`,
  // `pipeline` or `parallel` inside `mechanisms/fleet/*.js`. Those are globals the Workflow runtime
  // supplies and no file declares, so ESLint is correct about the text and wrong about the program.
  //
  // 45 unfixable errors are not neutral: they made `npm run lint` exit 1 permanently, and a gate
  // that is always red is a gate nobody reads. That is how a real finding in this project's own
  // source hides — which is exactly what happened, twice, in the run that produced this line.
  //
  // WHERE it was broken, stated because the first version of this note did not say and the two
  // cases are worth very different amounts. `.claude/` is gitignored and CI does not install it
  // (`git ls-files .claude` -> 0), so in CI the directory does not exist, ESLint never saw it, and
  // the chain ran whole. The breakage was LOCAL and total: every machine with the kit installed got
  // a permanently red `npm run lint`, and `knip` and `check-english-only` never ran there — `&&`
  // short-circuits. That is the gate a person runs before pushing, so the cost was paid by whoever
  // was trying to check their work, and never by CI.
  { ignores: ['dist/**', 'node_modules/**', 'deadcode-output/**', 'codex/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // #39 — `tools/` used to be ignored here, together with the dependency-cruiser config, on the
  // grounds that both are "Node CommonJS/ESM build scripts … with `module`/`require` in scope,
  // which the app's browser-ish globals exclude". Measured 2026-09-10, that reason is true of
  // exactly one of them:
  //
  //   npx eslint tools/ --no-ignore                 -> 0 problems
  //   npx eslint .dependency-cruiser.cjs --no-ignore -> 1 error, `'module' is not defined`
  //
  // The 25 ESM scripts under `tools/` never touch `module` or `require`, and the globals block
  // below already gives them `process`, `console`, `Buffer`, `URL` and `fetch` — so the exemption
  // bought nothing and cost the lint chain its own toolchain. That is what makes it worth removing
  // rather than leaving as a harmless line: `tools/build-cli.mjs` produces the `dist/theocode.mjs`
  // that `package.json:bin` points at, and every checker in the `lint` job lives here. The code
  // deciding whether other code may ship was the one part of the tree no linter read.
  //
  // "Zero problems" and "nothing was checked" print identically, so the removal was verified by
  // introducing a defect rather than by trusting the clean run: appending an empty `if` block to
  // `tools/check-sdk-pin.mjs` produced `203:23 error Empty block statement no-empty`, and removing
  // it returned the run to clean. ESLint reads these files.
  //
  // `.dependency-cruiser.cjs` is the genuine case, and it is answered rather than excused. It is
  // CommonJS — `module.exports` at line 12 — so `module` is declared for `**/*.cjs` instead of the
  // file being dropped from the run. It is gate configuration, and a gate config nothing lints is
  // the same gap this finding is about, one file smaller.
  //
  // What this buys, stated precisely so nobody "finishes the job" by accident: `tools/` now gets
  // `js.configs.recommended` and the fail-fast rule below. It does NOT get the complexity caps in
  // the `**/*.{ts,tsx}` block, and that is deliberate. Running them over `tools/` reports 20
  // pre-existing violations (`check-sdk-pin.mjs` `disagreement` at complexity 20,
  // `report-theokit-staleness.mjs` `main` at 17, four files past `max-lines-per-function`). The
  // header of this file states the bar every cap here was set to meet: measured zero on this tree,
  // so it freezes a good state instead of announcing debt. Widening those caps to `tools/` would
  // announce debt, which is a refactor decision and not a lint decision.
  { files: ['**/*.cjs'], languageOptions: { globals: { module: 'readonly' } } },
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    // A suppression that stopped being needed must fail, not whisper.
    //
    // ESLint 10 does not ignore an unused directive — measured here, `eslint --stdin` on a file
    // carrying a spurious `eslint-disable-next-line no-console` reports it. It reports it as a
    // WARNING, and `npm run lint` runs bare `eslint .` with no `--max-warnings`, so the run exits 0
    // and the chain moves on. A finding that cannot turn a build red is one nobody acts on, which
    // is how a suppression set only ever grows.
    //
    // `error` is what makes the set shrinkable. It is the other half of the `--` reason convention
    // the two directives in this tree now follow: the reason lets a human re-judge a suppression,
    // and this lets the linter retire one nobody re-judged.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'all', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-dupe-keys': 'error',
      'no-constant-condition': 'error',
      complexity: ['error', 10],
      'max-depth': ['error', 4],
      'max-params': ['error', 6],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-classes-per-file': ['error', 1],
    },
  },
  {
    // Fail-fast discipline: a rejection handler that discards the error is the most expensive
    // silence this product can ship — a PTY, a sandbox or an agent that never dies. `no-empty`
    // ignores function bodies by design, so neither shape below is caught without this rule.
    // Best-effort cleanup opts out per line with a written rationale.
    // `tests/**` is in scope since B-162 moved the tests out of `src/`: a swallowed rejection in a
    // test is the same silence, and scoping this to `src/` alone quietly dropped 191 files.
    // `tools/` is in scope since #39 un-ignored it, by the same argument one directory over: a
    // build script that swallows a rejection produces a green `npm run lint` over work that did not
    // happen, which is the failure mode those scripts exist to prevent. Free at the moment it was
    // added — measured 2026-09-10, both selectors report zero over `tools/`.
    files: [
      'packages/*/src/**/*.{ts,tsx}',
      'packages/*/tests/**/*.{ts,tsx}',
      'tools/**/*.mjs',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name="catch"] > ArrowFunctionExpression:matches([body.type="Identifier"][body.name="undefined"], [body.type="Literal"][body.raw="null"], [body.type="UnaryExpression"][body.operator="void"])',
          message:
            'A rejection handler that discards the error. Handle it, propagate it, or record it on stderr — and if it is best-effort cleanup, use `// eslint-disable-next-line no-restricted-syntax -- <rationale>`.',
        },
        {
          selector:
            'CallExpression[callee.property.name="catch"] > ArrowFunctionExpression > BlockStatement[body.length=0]',
          message:
            'A rejection handler with an empty body. `no-empty` does not catch this shape (it ignores function bodies by design).',
        },
      ],
    },
  },
  {
    // B-073 follow-up — `max-lines-per-function` does not apply to a `describe` block.
    //
    // The rule caps a FUNCTION's responsibility: a body past ~60 lines is usually doing more than
    // one thing. A `describe` is not that. It is a declaration grouping sibling `it`s, and its
    // length is the number of behaviours under test — a quantity `rules/testing.md` wants HIGH.
    // Capping it pushes toward fewer cases or arbitrary splits, which is the rule working against
    // the thing it exists to protect.
    //
    // Surfaced rather than chosen: `per-session.test.ts` tripped the rule at 62 lines after the
    // repository's own `prettier` reformatted it. That file was never formatted (there is no
    // `prettier --check` job in CI), so nothing forced the collision until now. The `it` bodies
    // themselves are unaffected — this exempts the file, not the discipline: `complexity`,
    // `max-depth` and `max-params` still apply, and those are what catch a test doing too much.
    files: ['**/*.test.{ts,tsx,mts,mjs}'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
)
