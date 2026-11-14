import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { exactVersionViolations, theokitStaleness } from '../../scripts/lib/app-dependencies.mjs'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('app dependency checks', () => {
  it('a workspace:* declaration is skipped by the staleness check and listed as in-repo', () => {
    const result = theokitStaleness([{ name: '@theokit/agents', range: 'workspace:*' }], {
      installedVersion: () => '2.0.0',
      publishedVersion: () => '1.9.0',
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
    const violations = exactVersionViolations({
      dependencies: { a: '^1.2.3', b: 'workspace:*', c: '1.2.3-next.0' },
    })
    expect(violations).toEqual([{ section: 'dependencies', name: 'a', specifier: '^1.2.3' }])
  })

  it('the CLI exits 1 and names the manifest and dependency for a violation', () => {
    const app = mkdtempSync(join(tmpdir(), 'app-deps-'))
    dirs.push(app)
    writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { left: '^1.0.0' } }))
    mkdirSync(join(app, 'packages', 'one'), { recursive: true })
    writeFileSync(
      join(app, 'packages', 'one', 'package.json'),
      JSON.stringify({ dependencies: { ok: '1.0.0' } }),
    )
    const run = spawnSync(process.execPath, ['scripts/check-app-dependencies.mjs', app], {
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain(join(app, 'package.json'))
    expect(run.stdout).toContain('left')
  })
})
