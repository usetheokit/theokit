import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('matches the committed package.json (fails on a stale manifest)', () => {
    const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
    assert.deepEqual(pkg.dependencies, deriveDependencies(), 'run `node sync-manifest.mjs`')
  })
})
