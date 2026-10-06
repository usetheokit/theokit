/**
 * B-010 — make the dependency direction enforceable, which the README already claimed it was.
 *
 * The claim rested on the `exports` map in each package.json. It does not hold: `tsconfig.json`
 * declares `@theocode/agent/*` → `./packages/agent/src/*`, a wildcard that reaches straight past the
 * declared entries into any internal file. TypeScript resolves through the paths mapping, so nothing
 * in the build ever consulted `exports`.
 *
 * dependency-cruiser was already a devDependency and unconfigured. These rules are the enforcement
 * the sentence promised.
 *
 * B-416 added `proof-imports-only-published-entry-points` and brought the test files into the
 * cruise: REQ-15 covers the proof tests themselves, and a test probe importing a package's `src/`
 * passed while `*.test.ts` was excluded. The five rules after it now govern test files as well.
 */
module.exports = {
  forbidden: [
    {
      // REQ-15, B-416: a proof exercises the framework through what a consumer can reach, so an
      // import, from source or test, that resolves into a theokit package's `src/` proves nothing.
      // The `from.pathNot` keeps the framework's own internal edges out: without it one violating
      // import reported 139 errors. Armed by
      // `tests/unit/a-proof-import-into-a-package-src-fails-the-boundary-check.test.ts`.
      name: 'proof-imports-only-published-entry-points',
      comment:
        'A proof imports a theokit package only through its published entry points (the exports ' +
        'map, which points into dist). Reaching into src tests code no consumer can import.',
      severity: 'error',
      from: { pathNot: '^(\\.\\./\\.\\./packages|node_modules)/' },
      to: { path: '^(\\.\\./\\.\\./packages|node_modules/@theokit)/[^/]+/src/' },
    },
    {
      name: 'agent-never-consumes-a-surface',
      comment:
        'The core must not depend on a surface. This is the direction the whole layout exists to ' +
        'express, and the one violation that would make the two surfaces inseparable.',
      severity: 'error',
      from: { path: '^packages/(agent|shared)/src' },
      to: { path: '^packages/(tui|cli)/src' },
    },
    {
      name: 'surfaces-never-consume-each-other',
      comment:
        'The TUI and the headless CLI are siblings. A dependency between them would make the ' +
        'headless surface drag in Ink and React.',
      severity: 'error',
      from: { path: '^packages/tui/src' },
      to: { path: '^packages/cli/src' },
    },
    {
      name: 'surfaces-never-consume-each-other-reverse',
      comment:
        'The same boundary in the other direction. It is a separate rule because dependency-cruiser ' +
        'matches from/to in one direction only, and a sibling dependency is worth refusing whichever ' +
        'way it points: the CLI reaching into the TUI would pull Ink and React into a headless run.',
      severity: 'error',
      from: { path: '^packages/cli/src' },
      to: { path: '^packages/tui/src' },
    },
    {
      name: 'shared-depends-on-nobody',
      comment: 'shared is the leaf: code both surfaces need, owned by neither.',
      severity: 'error',
      from: { path: '^packages/shared/src' },
      to: { path: '^packages/(agent|tui|cli)/src' },
    },
    {
      name: 'no-circular',
      comment: 'Acyclic Dependencies Principle — a cycle makes both ends untestable in isolation.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Test files are cruised (B-416); only a node_modules path segment is excluded.
    exclude: { path: '(^|/)node_modules/' },
  },
}
