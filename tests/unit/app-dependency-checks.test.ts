import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../../scripts/check-app-dependencies.mjs'
import {
  channelFor,
  collectDeclarations,
  compareVersions,
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

  it('a pin ahead of the published version is not behind, prereleases included', () => {
    const behind = (installed: string, latest: string) =>
      theokitStaleness([{ name: '@theokit/sdk', range: installed }], {
        installedVersion: () => installed,
        publishedVersion: () => latest,
      }).rows.some((row) => !row.current)
    expect(behind('2.0.0', '1.9.0')).toBe(false)
    expect(behind('1.0.0', '1.0.0-next.3')).toBe(false)
    expect(behind('1.0.0-next.10', '1.0.0-next.9')).toBe(false)
    expect(behind('1.0.0-next.1', '1.0.0')).toBe(true)
    expect(behind('1.0.0-alpha', '1.0.0-alpha.1')).toBe(true)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0)
  })

  it('the CLI finds a hoisted installation and lists in-repo links in text mode', () => {
    const app = fixture(
      {
        '.': {},
        'packages/one': {
          dependencies: { '@theokit/sdk': '1.0.0', '@theokit/agents': 'workspace:*' },
        },
      },
      { '.': { '@theokit/sdk': '1.0.0' } },
    )
    const result = run(app, () => ({ latest: '1.0.0' }))
    expect(result.code).toBe(0)
    expect(result.out).toContain('@theokit/agents')
  })

  it('parses version-qualified and nested overrides into package names and ranges', () => {
    const declarations = collectDeclarations({
      overrides: {
        '@theokit/sdk@^1': '1.2.3',
        '@theokit/tui': { '.': '0.80.0', nested: '2.0.0' },
        '@theokit/agents': { child: '$child', '.': '$agents' },
        other: '$other',
      },
    })
    expect(declarations).toEqual([
      { name: '@theokit/sdk', range: '1.2.3', override: '@theokit/sdk@^1' },
      { name: '@theokit/tui', range: '0.80.0', override: '@theokit/tui' },
      { name: 'nested', range: '2.0.0', override: '@theokit/tui > nested' },
    ])
  })

  it('keeps the full path so nested overrides of one package are judged separately', () => {
    const declarations = collectDeclarations({
      overrides: { a: { '@theokit/sdk': '1.0.0' }, b: { '@theokit/sdk': '2.0.0' } },
    })
    const result = theokitStaleness(declarations, {
      installedVersion: (_name, d) => d.range,
      publishedVersion: () => '2.0.0',
    })
    expect(result.rows.map((r) => [r.override, r.current])).toEqual([
      ['a > @theokit/sdk', false],
      ['b > @theokit/sdk', true],
    ])
  })

  it('a hyphen in build metadata is not a prerelease', () => {
    expect(channelFor('1.2.3+build-1')).toBe('latest')
    expect(channelFor('1.2.3-next.0')).toBe('next')
    expect(channelFor('1.2.3-next.0+b')).toBe('next')
  })

  const pnpmLayout = (app: string, sdkVersion: string | undefined) => {
    const store = 'node_modules/.pnpm/a@1.0.0'
    const installed: Record<string, string> = { a: '1.0.0' }
    if (sdkVersion) installed['@theokit/sdk'] = sdkVersion
    for (const [name, version] of Object.entries(installed)) {
      mkdirSync(join(app, store, 'node_modules', name), { recursive: true })
      writeFileSync(
        join(app, store, 'node_modules', name, 'package.json'),
        JSON.stringify({ version }),
      )
    }
    mkdirSync(join(app, 'node_modules'), { recursive: true })
    symlinkSync(join(app, store, 'node_modules', 'a'), join(app, 'node_modules', 'a'))
  }

  it('the CLI judges a nested override by following its path through the pnpm links', () => {
    const app = fixture({ '.': { overrides: { 'a>@theokit/sdk': '1.0.0' } } })
    pnpmLayout(app, '1.0.0')
    expect(run(app, () => ({ latest: '1.0.0' })).code).toBe(0)
    expect(run(app, () => ({ latest: '1.1.0' })).code).toBe(1)
  })

  it('the CLI judges a range override from the installation', () => {
    const app = fixture(
      { '.': { overrides: { '@theokit/sdk@^1': '^1.2.3' } } },
      { '.': { '@theokit/sdk': '1.2.4' } },
    )
    expect(run(app, () => ({ latest: '1.2.4' })).code).toBe(0)
    expect(run(app, () => ({ latest: '1.3.0' })).code).toBe(1)
  })

  it('the CLI leaves an override unjudged when the store holds the version for another package', () => {
    const app = fixture(
      { '.': { overrides: { 'a>@theokit/sdk': '1.0.0' } } },
      { 'node_modules/.pnpm/@theokit+sdk@1.0.0': { '@theokit/sdk': '1.0.0' } },
    )
    pnpmLayout(app, undefined)
    const result = run(app, () => ({ latest: '1.0.0' }))
    expect(result.code).toBe(2)
    expect(result.out).toContain('cannot be judged')
  })

  it('the CLI does not judge a nested override by the direct install of the same package', () => {
    const app = fixture(
      {
        '.': {
          dependencies: { '@theokit/sdk': '2.0.0' },
          overrides: { 'other>@theokit/sdk': '1.0.0' },
        },
      },
      {
        'node_modules/@theokit/sdk': { '@theokit/sdk': '2.0.0' },
        'node_modules/.pnpm/@theokit+sdk@2.0.0': { '@theokit/sdk': '2.0.0' },
      },
    )
    const result = run(app, () => ({ latest: '2.0.0' }))
    expect(result.code).toBe(2)
    expect(result.out).toContain('other>@theokit/sdk')
    expect(result.out).not.toContain('installed 2.0.0')
  })

  it('the CLI judges a top-level override that applies only to a transitive copy', () => {
    const app = fixture({
      '.': { dependencies: { a: '1.0.0' }, overrides: { '@theokit/sdk': '1.0.0' } },
    })
    pnpmLayout(app, '1.0.0')
    expect(run(app, () => ({ latest: '1.0.0' })).code).toBe(0)
    expect(run(app, () => ({ latest: '1.1.0' })).code).toBe(1)
  })

  it('the CLI leaves a range override unjudged when the resolved version does not satisfy it', () => {
    const app = fixture(
      { '.': { overrides: { '@theokit/sdk': '^1.2.3' } } },
      { '.': { '@theokit/sdk': '2.0.0' } },
    )
    const result = run(app, () => ({ latest: '2.0.0' }))
    expect(result.code).toBe(2)
    expect(result.out).toContain('cannot be judged')
  })

  it('the CLI leaves an override unjudged when installed copies differ', () => {
    const app = fixture(
      {
        '.': { dependencies: { a: '1.0.0', b: '1.0.0' }, overrides: { '@theokit/sdk': '^1.0.0' } },
      },
      {
        node_modules: { a: '1.0.0', b: '1.0.0' },
        'node_modules/a': { '@theokit/sdk': '1.5.0' },
        'node_modules/b': { '@theokit/sdk': '1.2.0' },
      },
    )
    expect(run(app, () => ({ latest: '1.5.0' })).code).toBe(2)
  })

  it('the CLI leaves a range it cannot evaluate unjudged', () => {
    const app = fixture(
      { '.': { overrides: { '@theokit/sdk': '>=1 <2' } } },
      { '.': { '@theokit/sdk': '2.0.0' } },
    )
    expect(run(app, () => ({ latest: '2.0.0' })).code).toBe(2)
  })

  it('the CLI follows a transitive override through a devDependency', () => {
    const app = fixture({
      '.': { devDependencies: { a: '1.0.0' }, overrides: { '@theokit/sdk': '1.0.0' } },
    })
    pnpmLayout(app, '1.0.0')
    expect(run(app, () => ({ latest: '1.0.0' })).code).toBe(0)
  })

  it('the CLI does not read an unresolved dependency from the working directory', () => {
    const app = fixture({ '.': { dependencies: { '@theokit/sdk': '1.0.0' } } })
    const cwd = fixture({ '.': { version: '1.0.0' } })
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/check-app-dependencies.mjs'), app],
      { cwd, encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
  })

  it('the CLI leaves an override unjudged when a copy outside the range sits beside a matching one', () => {
    const app = fixture(
      {
        '.': { dependencies: { a: '1.0.0', b: '1.0.0' }, overrides: { '@theokit/sdk': '^1.0.0' } },
      },
      {
        node_modules: { a: '1.0.0', b: '1.0.0' },
        'node_modules/a': { '@theokit/sdk': '1.5.0' },
        'node_modules/b': { '@theokit/sdk': '2.0.0' },
      },
    )
    expect(run(app, () => ({ latest: '1.5.0' })).code).toBe(2)
  })

  it('the CLI applies a nested override beneath a transitive ancestor', () => {
    const app = fixture(
      {
        '.': { dependencies: { a: '1.0.0' }, overrides: { 'b>@theokit/sdk': '1.0.0' } },
        'node_modules/a': { version: '1.0.0', dependencies: { b: '1.0.0' } },
        'node_modules/a/node_modules/b': { version: '1.0.0', dependencies: { c: '1.0.0' } },
        'node_modules/a/node_modules/b/node_modules/c': {
          version: '1.0.0',
          dependencies: { '@theokit/sdk': '1.0.0' },
        },
      },
      { 'node_modules/a/node_modules/b/node_modules/c': { '@theokit/sdk': '1.0.0' } },
    )
    expect(run(app, () => ({ latest: '1.0.0' })).code).toBe(0)
    expect(run(app, () => ({ latest: '1.1.0' })).code).toBe(1)
  })

  it('the CLI judges every ancestor copy of a nested override', () => {
    const app = fixture(
      {
        '.': { dependencies: { a: '1.0.0', b: '1.0.0' }, overrides: { 'c>@theokit/sdk': '1.0.0' } },
        'node_modules/a': { version: '1.0.0', dependencies: { c: '1.0.0' } },
        'node_modules/b': { version: '1.0.0', dependencies: { c: '1.0.0' } },
        'node_modules/a/node_modules/c': { version: '1.0.0' },
        'node_modules/b/node_modules/c': { version: '1.0.0' },
      },
      {
        'node_modules/a/node_modules/c': { '@theokit/sdk': '1.0.0' },
        'node_modules/b/node_modules/c': { '@theokit/sdk': '1.2.0' },
      },
    )
    expect(run(app, () => ({ latest: '1.2.0' })).code).toBe(2)
  })
})
