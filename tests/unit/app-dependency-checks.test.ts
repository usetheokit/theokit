import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../../scripts/check-app-dependencies.mjs'
import {
  collectDeclarations,
  exactVersionViolations,
  theokitStaleness,
} from '../../scripts/lib/app-dependencies.mjs'

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

  const fixture = (
    manifests: Record<string, unknown>,
    installed: Record<string, Record<string, string>> = {},
  ) => {
    const app = mkdtempSync(join(tmpdir(), 'app-deps-'))
    dirs.push(app)
    for (const [dir, manifest] of Object.entries(manifests)) {
      mkdirSync(join(app, dir), { recursive: true })
      writeFileSync(join(app, dir, 'package.json'), JSON.stringify(manifest))
    }
    for (const [dir, versions] of Object.entries(installed)) {
      for (const [name, version] of Object.entries(versions)) {
        mkdirSync(join(app, dir, 'node_modules', name), { recursive: true })
        writeFileSync(
          join(app, dir, 'node_modules', name, 'package.json'),
          JSON.stringify({ version }),
        )
      }
    }
    return app
  }
  const run = (appDir: string, publishedTags: (name: string) => Record<string, string>) => {
    const out: string[] = []
    const code = runCli({
      appDir,
      write: (l) => out.push(l),
      writeError: (l) => out.push(l),
      publishedTags,
    })
    return { code, out: out.join('\n') }
  }

  it('the CLI exits 1 when a registry pin is behind, reading a package-local installation', () => {
    const app = fixture(
      { '.': {}, 'packages/one': { dependencies: { '@theokit/sdk': '1.0.0' } } },
      { 'packages/one': { '@theokit/sdk': '1.0.0' } },
    )
    const result = run(app, () => ({ latest: '1.1.0' }))
    expect(result.code).toBe(1)
    expect(result.out).toContain('@theokit/sdk installed 1.0.0, published 1.1.0')
    expect(run(app, () => ({ latest: '1.0.0' })).code).toBe(0)
  })

  it('the CLI exits 2 when a pin is not installed or the registry is unavailable', () => {
    const app = fixture({ '.': { dependencies: { '@theokit/sdk': '1.0.0' } } })
    expect(run(app, () => ({ latest: '1.0.0' })).out).toContain('not installed')
    expect(run(app, () => ({ latest: '1.0.0' })).code).toBe(2)
    const installed = fixture(
      { '.': { dependencies: { '@theokit/sdk': '1.0.0' } } },
      { '.': { '@theokit/sdk': '1.0.0' } },
    )
    const failing = run(installed, () => {
      throw new Error('offline')
    })
    expect(failing.code).toBe(2)
    expect(failing.out).toContain('offline')
  })

  it('a peerDependencies pin is collected for staleness', () => {
    expect(collectDeclarations({ peerDependencies: { '@theokit/tui': '0.80.0' } })).toEqual([
      { name: '@theokit/tui', range: '0.80.0' },
    ])
  })
})
