import { createRequire } from 'node:module'

/**
 * The version `create-theokit --version` answers with — read from the package manifest, never
 * copied. It was a literal `'0.8.0'` at package version 1.23.7: fifteen minors of drift that no
 * check could catch, because a string in source has no relationship to the manifest beside it.
 *
 * `src/cli.ts` and `dist/cli.js` both sit one level under the package root, so the same relative
 * path resolves from source and from the bundle. `tests/unit/cli-version-matches-manifest` fails
 * if that stops being true.
 */
function readVersion(): string {
  const require = createRequire(import.meta.url)
  const pkg = require('../package.json') as { version: string }
  return pkg.version
}

export const CLI_VERSION = readVersion()
