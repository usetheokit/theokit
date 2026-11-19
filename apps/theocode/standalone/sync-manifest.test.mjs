import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { deriveDependencies, lockfileDrift, validateReleased } from './sync-manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'sync-manifest-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function fixture(released, pkgDeps) {
  const root = join(tmp, String(n++))
  mkdirSync(join(root, 'packages', 'a'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { zod: '^4.0.0' } }))
  writeFileSync(
    join(root, 'packages', 'a', 'package.json'),
    JSON.stringify({ dependencies: pkgDeps }),
  )
  const releasedPath = join(root, 'released.json')
  writeFileSync(releasedPath, JSON.stringify(released))
  return { root, releasedPath }
}

describe('sync-manifest', () => {
  it('substitutes workspace specs with pins, skips @theocode/*, and sorts', () => {
    const deps = deriveDependencies(
      fixture(
        { '@theokit/agents': '1.2.3' },
        {
          '@theokit/agents': 'workspace:*',
          '@theocode/x': 'workspace:*',
          ink: '^7.1.0',
        },
      ),
    )
    assert.deepEqual(deps, { '@theokit/agents': '1.2.3', ink: '^7.1.0', zod: '^4.0.0' })
    assert.deepEqual(Object.keys(deps), ['@theokit/agents', 'ink', 'zod'])
  })

  it('names the package and fix when a pin is missing', () => {
    assert.throws(
      () => deriveDependencies(fixture({}, { '@theokit/agents': 'workspace:*' })),
      /@theokit\/agents .*no entry in released\.json: add it/,
    )
  })

  it('rejects conflicting specs', () => {
    assert.throws(
      () => deriveDependencies(fixture({}, { zod: '^3.0.0' })),
      /zod: conflicting specs/,
    )
  })

  it('rejects pins that are not exact versions', () => {
    assert.throws(() => validateReleased({ a: '^1.0.0' }), /exact version/)
    assert.throws(() => validateReleased({ a: 'latest' }), /exact version/)
    assert.throws(() => validateReleased({ a: 1 }), /exact version/)
    assert.deepEqual(validateReleased({ a: '1.0.0-rc.1' }), { a: '1.0.0-rc.1' })
  })

  it('rejects strings that are not valid semantic versions', () => {
    for (const bad of ['01.2.3', '1.02.3', '1.2.3-', '1.2.3-..', '1.2.3-a..b', '1.2.3-01', '1.2']) {
      assert.throws(() => validateReleased({ a: bad }), /exact version/, bad)
    }
    assert.doesNotThrow(() => validateReleased({ a: '1.2.3-0.alpha-1.x' }))
  })

  describe('command', () => {
    // Copy the script into <root>/standalone so its `..` root is the isolated fixture.
    function setup(standaloneDeps) {
      const { root } = fixture({ '@theokit/agents': '1.2.3' }, { '@theokit/agents': 'workspace:*' })
      const dir = join(root, 'standalone')
      mkdirSync(dir)
      copyFileSync(join(here, 'sync-manifest.mjs'), join(dir, 'sync-manifest.mjs'))
      writeFileSync(join(dir, 'released.json'), JSON.stringify({ '@theokit/agents': '1.2.3' }))
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'x', dependencies: standaloneDeps }),
      )
      return dir
    }
    const run = (dir, ...args) =>
      spawnSync(process.execPath, [join(dir, 'sync-manifest.mjs'), ...args], { encoding: 'utf8' })

    it('regenerates package.json dependencies, then --check passes', () => {
      const dir = setup({ stale: '1.0.0' })
      assert.equal(run(dir).status, 0)
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      assert.equal(pkg.name, 'x')
      assert.deepEqual(pkg.dependencies, { '@theokit/agents': '1.2.3', zod: '^4.0.0' })
      writeFileSync(
        join(dir, 'pnpm-lock.yaml'),
        "importers:\n\n  .:\n    dependencies:\n      '@theokit/agents':\n        specifier: 1.2.3\n        version: 1.2.3\n      zod:\n        specifier: ^4.0.0\n        version: 4.0.0\n\npackages:\n",
      )
      assert.equal(run(dir, '--check').status, 0)
    })

    it('reports a missing released.json with the fix instead of ENOENT', () => {
      const dir = setup({})
      rmSync(join(dir, 'released.json'))
      const r = run(dir, '--check')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /released\.json not found/)
      assert.doesNotMatch(r.stderr, /ENOENT/)
    })

    it('--check fails on a stale manifest without rewriting it', () => {
      const dir = setup({ stale: '1.0.0' })
      const before = readFileSync(join(dir, 'package.json'), 'utf8')
      const r = run(dir, '--check')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /out of date/)
      for (const f of ['released.json', 'package.json', 'pnpm-lock.yaml'])
        assert.ok(r.stderr.includes(f), `stderr names ${f}`)
      assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before)
    })
  })

  describe('real manifests', () => {
    const realRoot = join(here, '..')
    const read = (p) => readFileSync(p, 'utf8')
    // A copy of TheoCode's real manifests plus this consumer's real files, laid out like the repo.
    function realCopy() {
      const root = join(tmp, `real-${n++}`)
      mkdirSync(join(root, 'packages'), { recursive: true })
      copyFileSync(join(realRoot, 'package.json'), join(root, 'package.json'))
      for (const d of readdirSync(join(realRoot, 'packages'), { withFileTypes: true })) {
        if (!d.isDirectory()) continue
        mkdirSync(join(root, 'packages', d.name))
        copyFileSync(
          join(realRoot, 'packages', d.name, 'package.json'),
          join(root, 'packages', d.name, 'package.json'),
        )
      }
      const dir = join(root, 'standalone')
      mkdirSync(dir)
      for (const f of ['sync-manifest.mjs', 'released.json', 'package.json', 'pnpm-lock.yaml'])
        copyFileSync(join(here, f), join(dir, f))
      return dir
    }
    const run = (dir, ...args) =>
      spawnSync(process.execPath, [join(dir, 'sync-manifest.mjs'), ...args], { encoding: 'utf8' })

    it('derives exactly the committed package.json and lockfile specifiers', () => {
      const deps = deriveDependencies()
      assert.deepEqual(deps, JSON.parse(read(join(here, 'package.json'))).dependencies)
      assert.deepEqual(lockfileDrift(deps, read(join(here, 'pnpm-lock.yaml'))), [])
    })

    it('pins every workspace framework dependency to released.json', () => {
      const released = JSON.parse(read(join(here, 'released.json')))
      const deps = deriveDependencies()
      for (const [name, version] of Object.entries(released)) assert.equal(deps[name], version)
    })

    it('--check passes on a copy of the real inputs', () => {
      assert.equal(run(realCopy(), '--check').status, 0)
    })

    it('--check detects a moved release pin, and regeneration alone leaves the lockfile stale', () => {
      const dir = realCopy()
      const released = JSON.parse(read(join(dir, 'released.json')))
      // Any exact version other than the current pin moves it, so this keeps holding after release updates.
      const [major, minor, patch] = released['@theokit/agents-pty'].split(/[.-]/).map(Number)
      released['@theokit/agents-pty'] = `${major}.${minor}.${patch + 1}`
      writeFileSync(join(dir, 'released.json'), JSON.stringify(released))
      const drifted = run(dir, '--check')
      assert.equal(drifted.status, 1)
      assert.match(drifted.stderr, /package\.json is out of date/)
      assert.equal(run(dir).status, 0)
      const stale = run(dir, '--check')
      assert.equal(stale.status, 1)
      assert.match(stale.stderr, /pnpm-lock\.yaml is out of date for @theokit\/agents-pty/)
    })

    it('--check detects a hand-edited package.json and a missing lockfile', () => {
      const dir = realCopy()
      const pkg = JSON.parse(read(join(dir, 'package.json')))
      pkg.dependencies.zod = '^3.0.0'
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
      assert.equal(run(dir, '--check').status, 1)
      const dir2 = realCopy()
      rmSync(join(dir2, 'pnpm-lock.yaml'))
      assert.match(run(dir2, '--check').stderr, /pnpm-lock\.yaml is out of date/)
    })
  })
})
