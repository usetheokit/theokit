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
 */
module.exports = {
  forbidden: [
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
    exclude: { path: '\\.test\\.tsx?$' },
  },
}
