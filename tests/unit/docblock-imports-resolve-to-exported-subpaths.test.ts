import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A docblock `@example` is what an editor tooltip shows, and it is copied as written. An import of
 * a subpath that `package.json#exports` does not declare fails at load with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`, so the example teaches code that cannot run.
 *
 * `defineWebhook` shipped one (`theokit/server/webhook/providers`, usetheokit/theokit#1024). The
 * check reads the manifest rather than a list, so a subpath added or removed later is judged
 * against what is actually published.
 */
const ROOT = resolve(import.meta.dirname, '../..')

function exportedSubpaths(): Set<string> {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages/theo/package.json'), 'utf-8')) as {
    exports: Record<string, unknown>
  }
  return new Set(Object.keys(pkg.exports).map((key) => key.replace(/^\.\/?/, '')))
}

function docblockImports(): { location: string; specifier: string }[] {
  const out = execFileSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    'git',
    [
      '-C',
      ROOT,
      'grep',
      '-n',
      '-E',
      String.raw`^\s*\*.*from '(theokit(/[^']*)?)'`,
      '--',
      'packages/theo/src',
    ],
    { encoding: 'utf-8' },
  )
  const found: { location: string; specifier: string }[] = []
  for (const line of out.split('\n')) {
    const match = /from '(theokit[^']*)'/.exec(line)
    if (match) found.push({ location: line.split(':').slice(0, 2).join(':'), specifier: match[1] })
  }
  return found
}

describe('docblock examples import only published subpaths', () => {
  it('finds docblock imports to check, so an empty scan cannot pass', () => {
    expect(docblockImports().length).toBeGreaterThan(0)
  })

  it('every theokit subpath a docblock imports is declared in package.json#exports', () => {
    const exported = exportedSubpaths()
    const unexported = docblockImports().filter(
      ({ specifier }) => !exported.has(specifier.replace(/^theokit\/?/, '')),
    )
    expect(unexported).toEqual([])
  })
})
