import { createRequire } from 'node:module'

/**
 * The version `theokit --version` answers with — read from the package manifest, never copied.
 *
 * The CLI declared `cli.version('0.1.0-alpha.0')` while the package shipped 0.48.8. A literal in
 * source has no link to the manifest beside it, so nothing was wrong until someone quoted it in a
 * bug report.
 *
 * The relative path resolves identically from source and from the bundle: `src/cli/index.ts` and
 * `dist/cli/index.js` both sit two levels under the package root, and this module is inlined into
 * that entry rather than code-split (tsup bundles per entry). `tests/unit/cli-version-matches-manifest`
 * fails if that stops being true.
 */
export function cliVersion(): string {
  const require = createRequire(import.meta.url)
  // Code-split chunks sit at varying depths under dist/, so walk up to the package manifest.
  for (const rel of ['../../package.json', '../package.json', '../../../package.json']) {
    try {
      const pkg = require(rel) as { name?: string; version?: string }
      if (pkg.name === 'theokit' && pkg.version) return pkg.version
    } catch {
      // try the next candidate
    }
  }
  throw new Error('theokit: cannot locate package.json to read the CLI version')
}
