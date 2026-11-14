/**
 * The dependency-cruiser rule every proof app shares: a proof imports theokit packages only
 * through their published entry points.
 *
 * An app's `.dependency-cruiser.cjs` lists it in `forbidden`:
 * `require('../../tooling/depcruise/proof-boundary.cjs').proofImportsOnlyPublishedEntryPoints`.
 *
 * REQ-15, B-416: a proof exercises the framework through what a consumer can reach, so an
 * import, from source or test, that resolves into a package's `src/` proves nothing. The
 * `from.pathNot` keeps the framework's own internal edges out: without it one violating
 * import reported 139 errors, because the cruise follows into `packages/<pkg>/src`.
 * `to.path` names only `../../packages/`: a workspace specifier such as
 * `@theokit/agents/src/index.ts` resolves through the pnpm symlink to that path (measured
 * 2026-10-09), and a module under `node_modules/` is dropped by `options.exclude` before any
 * rule sees it, so a `node_modules/@theokit` alternative could never fire. Only `src/` is
 * refused; an import of a dist file outside the exports map is not.
 */
const proofImportsOnlyPublishedEntryPoints = {
  name: 'proof-imports-only-published-entry-points',
  comment:
    'A proof imports a theokit package only through its published entry points (the exports ' +
    'map, which points into dist). Reaching into src tests code no consumer can import.',
  severity: 'error',
  from: { pathNot: '^(\\.\\./\\.\\./packages|node_modules)/' },
  to: { path: '^\\.\\./\\.\\./packages/[^/]+/src/' },
}

module.exports = { proofImportsOnlyPublishedEntryPoints }
