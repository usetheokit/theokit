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
 * The first rule below was proven to arm by a deliberate violation; the second names a directory
 * that exists and has an EMPTY source set today, because `src/` holds one file and the rule's own
 * negative lookahead excludes it. It arms — proven under a second importer in a throwaway tree —
 * and it cannot fire here until `src/` has a second file. Stated because this file's whole premise
 * is that a rule which cannot fire is the hazard, and an earlier draft of this line claimed both
 * had fired.
 * before being committed.
 */
module.exports = {
  forbidden: [
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
    exclude: { path: 'node_modules|dist' },
  },
}
