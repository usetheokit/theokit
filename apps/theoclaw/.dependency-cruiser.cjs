/**
 * Architecture boundaries for `apps/theoclaw`.
 *
 * The monorepo's root `.dependency-cruiser.cjs` scopes every rule to
 * `^packages/theo/src/`, so `apps/` was covered by nothing and `/code-quality`'s D5
 * detector reported "no architecture rules declared" — correctly.
 *
 * **Only rules that can fire are declared here.** The golden rule caps a vacuous
 * architecture rule at FAIL_HARD alongside a violated one, and for good reason: a rule
 * naming a directory that does not exist passes green forever and reads as protection.
 * `proof-imports-only-published-entry-points` is armed by deliberate violations that a test runs
 * on every suite run (B-416). `production-must-not-import-tests` was proven to arm by a deliberate
 * violation; `composition-root-is-the-top-layer` names a directory
 * that exists and has an EMPTY source set today, because `src/` holds one file and the rule's own
 * negative lookahead excludes it. It arms — proven under a second importer in a throwaway tree —
 * and it cannot fire here until `src/` has a second file. Stated because this file's whole premise
 * is that a rule which cannot fire is the hazard, and an earlier draft of this line claimed the
 * two older rules had both fired.
 *
 * `boundaries` cruises `src` and `tests` only, so `tools/` and the root config files are outside
 * every rule here; they are repository tooling, not proofs.
 */
module.exports = {
  forbidden: [
    {
      // REQ-15, B-416: a proof exercises the framework through what a consumer can reach, so an
      // import, from source or test, that resolves into a package's `src/` proves nothing. The
      // `from.pathNot` keeps the framework's own internal edges out: without it one violating
      // import reported 139 errors, because the cruise follows into `packages/agents/src`. Armed by
      // `tests/unit/a-proof-import-into-a-package-src-fails-the-boundary-check.test.ts`.
      // `to.path` names only `../../packages/`: a workspace specifier such as
      // `@theokit/agents/src/index.ts` resolves through the pnpm symlink to that path (measured
      // 2026-10-09), and a module under `node_modules/` is dropped by `options.exclude` before any
      // rule sees it, so a `node_modules/@theokit` alternative could never fire. Only `src/` is
      // refused; an import of a dist file outside the exports map is not.
      name: 'proof-imports-only-published-entry-points',
      severity: 'error',
      comment:
        'A proof imports a theokit package only through its published entry points (the exports ' +
        'map, which points into dist). Reaching into src tests code no consumer can import.',
      from: { pathNot: '^(\\.\\./\\.\\./packages|node_modules)/' },
      to: { path: '^\\.\\./\\.\\./packages/[^/]+/src/' },
    },
    {
      name: 'production-must-not-import-tests',
      severity: 'error',
      comment:
        'Production code importing a test file ships the test to whoever installs this. ' +
        'The direction is one-way: tests may import src, never the reverse.',
      from: { path: '^src/' },
      to: { path: '^tests/' },
    },
    {
      name: 'composition-root-is-the-top-layer',
      severity: 'error',
      comment:
        'rules/architecture.md § 1 — the composition root wires concretes and nothing ' +
        'imports it back except an entry point. When a domain layer appears, this rule ' +
        'is what keeps the dependency pointing one way.',
      from: { path: '^src/(?!composition\\.ts$)' },
      to: { path: '^src/composition\\.ts$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Whole path segments only: a substring match also dropped app files such as
    // `distribution.ts` from the cruise, and every rule then passed them unread (B-416).
    exclude: { path: '(^|/)(node_modules|dist)/' },
  },
}
