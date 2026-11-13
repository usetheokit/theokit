import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCli } from '../../scripts/check-app-dependencies.mjs'
import { exactVersionViolations, theokitStaleness } from '../../scripts/lib/app-dependencies.mjs'

describe('app dependency checks', () => {
  it('a workspace:* declaration is skipped by the staleness check and listed as in-repo', () => {
    const result = theokitStaleness([{ name: '@theokit/agents', range: 'workspace:*' }], {
      installedVersion: { '@theokit/agents': '12.0.0' },
      publishedVersion: { '@theokit/agents': '11.0.0' },
    })
    expect(result.rows).toEqual([])
    expect(result.inRepo).toEqual(['@theokit/agents'])
  })

  it('a registry pin behind the published version is reported behind', () => {
    const result = theokitStaleness([{ name: '@theokit/sdk', range: '5.15.3' }], {
      installedVersion: () => '5.15.3',
      publishedVersion: () => '6.0.0',
    })
    expect(result.rows).toEqual([
      { name: '@theokit/sdk', installed: '5.15.3', latest: '6.0.0', current: false, major: true },
    ])
    expect(result.inRepo).toEqual([])
  })

  it('a caret range is an exact-version violation', () => {
    const manifest = {
      dependencies: { a: '^1.2.3', b: 'workspace:*' },
      devDependencies: { c: '1.2.3-next.0' },
    }
    expect(exactVersionViolations(manifest)).toEqual([
      { section: 'dependencies', name: 'a', specifier: '^1.2.3' },
    ])
  })

  it('the CLI exits 1 and names the manifest and dependency for a violation', () => {
    const app = mkdtempSync(join(tmpdir(), 'app-deps-'))
    mkdirSync(join(app, 'packages', 'core'), { recursive: true })
    writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { left: '1.0.0' } }))
    writeFileSync(
      join(app, 'packages', 'core', 'package.json'),
      JSON.stringify({ dependencies: { right: '^2.0.0' } }),
    )
    const out: string[] = []
    const code = runCli({
      appDir: app,
      write: (l) => out.push(l),
      writeError: (l) => out.push(l),
      tagsFor: () => ({ latest: '1.0.0' }),
    })
    expect(code).toBe(1)
    expect(out.join('\n')).toContain(join('packages', 'core', 'package.json'))
    expect(out.join('\n')).toContain('right')
  })
})
