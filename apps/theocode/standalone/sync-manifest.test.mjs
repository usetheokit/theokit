import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { deriveDependencies, validateReleased } from './sync-manifest.mjs'

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
      assert.equal(run(dir, '--check').status, 0)
    })

    it('--check fails on a stale manifest without rewriting it', () => {
      const dir = setup({ stale: '1.0.0' })
      const before = readFileSync(join(dir, 'package.json'), 'utf8')
      const r = run(dir, '--check')
      assert.equal(r.status, 1)
      assert.match(r.stderr, /out of date/)
      assert.match(r.stderr, /released\.json/)
      assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before)
    })
  })
})
