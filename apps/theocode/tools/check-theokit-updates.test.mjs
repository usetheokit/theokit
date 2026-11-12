/**
 * #73 — the watcher compared against `latest`, and this repository lives on `next`.
 *
 * `@theokit/sdk` was pinned to `5.0.0-next.1` while `latest` was `4.63.4`, so the row read
 * "behind 4.63.4" — a version we deliberately did not want — and could not see `5.0.0-next.3`, the
 * one we did. Two measured instances in one day: `readSessionMessages` publishing on `next`, and
 * `@theokit/agents@13.0.0-next.0` carrying the forward that unblocked `.claude/` interop. Both were
 * found by hand while answering "is anything pending?", which is the question this tool exists to
 * answer without anyone re-deriving it.
 *
 * The channel is read from the INSTALLED version, not configured: a repository that pins a
 * prerelease has already said which channel it tracks, and asking it to say so twice is a second
 * place to drift.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { channelFor, publishedFor } from './check-theokit-updates.mjs'

describe('#73 — which channel a package is tracked on', () => {
  it('test_a_prerelease_pin_is_tracked_on_next', () => {
    expect(channelFor('5.0.0-next.1')).toBe('next')
  })

  it('test_a_stable_pin_is_tracked_on_latest', () => {
    expect(channelFor('4.63.4')).toBe('latest')
  })

  it('test_an_absent_install_falls_back_to_latest', () => {
    // Nothing installed says nothing about a channel, and guessing `next` there would report every
    // fresh checkout as behind a prerelease it never asked for.
    expect(channelFor(undefined)).toBe('latest')
  })
})

describe('#73 — the version a row compares against', () => {
  const tags = { latest: '4.63.4', next: '5.0.0-next.3' }

  it('test_a_prerelease_pin_is_compared_against_next', () => {
    expect(publishedFor('5.0.0-next.1', tags)).toEqual({ version: '5.0.0-next.3', channel: 'next' })
  })

  it('test_a_stable_pin_is_compared_against_latest', () => {
    expect(publishedFor('4.63.3', tags)).toEqual({ version: '4.63.4', channel: 'latest' })
  })

  it('test_a_package_with_no_next_tag_falls_back_to_latest', () => {
    // Most `@theokit/*` packages publish no prerelease. Reporting them as unknown would turn four
    // correct rows into four question marks.
    expect(publishedFor('0.80.0-next.1', { latest: '0.80.0' })).toEqual({
      version: '0.80.0',
      channel: 'latest',
    })
  })

  it('test_the_channel_travels_with_the_number', () => {
    // A version with no channel beside it is the ambiguity that produced this issue: the row said
    // 4.63.4 and the reader could not tell which question it answered.
    expect(publishedFor('5.0.0-next.1', tags).channel).toBe('next')
  })
})

/**
 * #1898 — a `workspace:` declaration is a link to this monorepo, not a registry pin.
 *
 * The script finds its root from its own location, so it is copied into a throwaway tree with a
 * manifest, an installed copy of each package, and a fake `npm` that answers the dist-tags query.
 */
describe('#1898 — workspace links are not compared with the registry', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function run(dependencies, installed, published) {
    const root = mkdtempSync(join(tmpdir(), 'theokit-updates-'))
    dirs.push(root)
    mkdirSync(join(root, 'tools'))
    mkdirSync(join(root, 'packages'))
    mkdirSync(join(root, 'bin'))
    copyFileSync(join(here, 'check-theokit-updates.mjs'), join(root, 'tools', 'check-theokit-updates.mjs'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies }))
    for (const [name, version] of Object.entries(installed)) {
      const dir = join(root, 'node_modules', ...name.split('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
    }
    const npm = join(root, 'bin', 'npm')
    writeFileSync(
      npm,
      `#!/bin/sh\ncase "$2" in\n${Object.entries(published)
        .map(([n, v]) => `${n}) echo '{"latest":"${v}"}';;`)
        .join('\n')}\n*) exit 1;;\nesac\n`,
    )
    chmodSync(npm, 0o755)
    return spawnSync(process.execPath, [join(root, 'tools', 'check-theokit-updates.mjs'), '--json'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
    })
  }

  it('does not count a workspace link as behind when the local version is ahead of the registry', () => {
    const res = run({ '@theokit/agents': 'workspace:*' }, { '@theokit/agents': '2.0.0' }, { '@theokit/agents': '1.0.0' })
    const report = JSON.parse(res.stdout)
    expect(res.status).toBe(0)
    expect(report.rows).toEqual([])
    expect(report.workspaceLinks).toEqual(['@theokit/agents'])
  })

  it('still exits 1 for a registry pin that is behind', () => {
    const res = run(
      { '@theokit/agents': 'workspace:*', '@theokit/sdk': '5.15.3' },
      { '@theokit/agents': '2.0.0', '@theokit/sdk': '5.15.3' },
      { '@theokit/agents': '1.0.0', '@theokit/sdk': '5.16.0' },
    )
    const report = JSON.parse(res.stdout)
    expect(res.status).toBe(1)
    expect(report.rows.map((r) => r.name)).toEqual(['@theokit/sdk'])
  })
})
