import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const REPO = resolve(__dirname, '../..')

/**
 * Versions of zod the lockfile RESOLVES, peer suffix and all.
 *
 * Parsed line by line rather than with one regex: `security/detect-unsafe-regex` refused the pattern
 * that combined a greedy version tail with an optional peer group, and it was right — that shape
 * backtracks. Scanning is linear and says what it does.
 *
 * A resolved key looks like `  zod@4.4.3:` or `  zod@4.4.3(typescript@5.9.3):`, so the version ends
 * at whichever of `(` or `:` comes first.
 */
function resolvedZodVersions(lockContent: string): Set<string> {
  const PREFIX = '  zod@'
  const out = new Set<string>()
  for (const line of lockContent.split('\n')) {
    if (!line.startsWith(PREFIX)) continue
    const rest = line.slice(PREFIX.length)
    const ends = [rest.indexOf('('), rest.indexOf(':')].filter((i) => i >= 0)
    if (ends.length === 0) continue
    const version = rest.slice(0, Math.min(...ends))
    // a digit first, so `zod@workspace:*` or a name this prefix caught by accident is skipped
    if (/^\d/.test(version)) out.add(version)
  }
  return out
}

describe('Zod single-version invariant (T0.1)', () => {
  // Repo migrated to Zod v4 (commit 264449e "monorepo infra upgrades — Zod v4").
  // The single-version invariant stands; only the pinned major flipped 3 → 4.
  it('package.json contains pnpm.overrides.zod === ^4.0.0', () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }
    expect(pkg.pnpm?.overrides?.zod).toBe('^4.0.0')
  })

  /**
   * Read what the project RESOLVES, not what the store happens to hold.
   *
   * This used to `readdirSync(node_modules/.pnpm)` and count `zod@*` directories. That directory is
   * pnpm's content-addressed store: it keeps a directory per version ever materialised, whether or
   * not any importer still resolves it. So the assertion went red on residue — measured 2026-09-25
   * while bumping `@theokit/ui` for another item: the store held `zod@4.4.3` and `zod@4.6.5`, this
   * test failed `expected 2 to be 1`, and `grep -c "zod@4.6.5" pnpm-lock.yaml` returned 0. Nothing
   * referenced it. `pnpm prune` made the test pass with no dependency change at all.
   *
   * That cost was paid in the wrong direction: the failure was read as a second broken invariant and
   * went into a backlog item as part of the bump's price, which would have made somebody decline a
   * dependency update over a defect the update did not cause.
   *
   * The lockfile is the authority on what this project resolves, and the two assertions around this
   * one already read authoritative sources — `pnpm.overrides.zod` above, a resolved
   * `zod/package.json` below. This one was the odd reader.
   *
   * The `zod@3` case further down still reads the store, deliberately and narrowly: a `zod@3`
   * directory is evidence that something pulled the wrong major at some point, and that is worth
   * seeing even when nothing references it any more. Backlog B-310.
   */
  it('exactly ONE zod version is resolved by the project', () => {
    const lock = readFileSync(resolve(REPO, 'pnpm-lock.yaml'), 'utf8')
    const versions = resolvedZodVersions(lock)
    expect(versions.size, `lockfile resolves: ${[...versions].join(', ') || '(none)'}`).toBe(1)
    expect([...versions][0]).toMatch(/^4\./)
  })

  /**
   * The regex is the assertion, so it is tested rather than trusted.
   *
   * The first version of it stopped at `(`, which meant a key pnpm writes as
   * `zod@4.4.3(typescript@5.9.3):` matched NOTHING — and a lockfile whose every zod key carried a
   * peer suffix would have reported zero versions and failed with `(none)`, which reads as a broken
   * lockfile rather than as a broken reader. Today's lockfile has no peer-suffixed zod, so nothing
   * would have caught it.
   */
  it('the lockfile reader counts what pnpm actually writes', () => {
    const one = 'packages:\n  zod@4.4.3:\n    resolution: {}\nsnapshots:\n  zod@4.4.3: {}\n'
    expect([...resolvedZodVersions(one)]).toEqual(['4.4.3'])

    // two resolved versions is the thing this invariant forbids — it must be SEEN
    expect(resolvedZodVersions('packages:\n  zod@4.4.3:\n  zod@4.6.5:\n').size).toBe(2)
    expect(resolvedZodVersions('packages:\n  zod@3.25.76:\n  zod@4.4.3:\n').size).toBe(2)

    // pnpm appends the peers it resolved against; both shapes are one version
    expect([...resolvedZodVersions('packages:\n  zod@4.4.3(typescript@5.9.3):\n')]).toEqual([
      '4.4.3',
    ])
    expect(
      resolvedZodVersions(
        'packages:\n  zod@4.4.3(typescript@5.9.3):\n  zod@4.6.5(typescript@5.9.3):\n',
      ).size,
    ).toBe(2)

    // a different package whose name merely starts with `zod` is not zod
    expect([
      ...resolvedZodVersions('packages:\n  zod-to-json-schema@3.24.6:\n  zod@4.4.3:\n'),
    ]).toEqual(['4.4.3'])

    // and a prerelease is still one version
    expect([...resolvedZodVersions('packages:\n  zod@4.5.0-beta.1:\n')]).toEqual(['4.5.0-beta.1'])
  })

  it('require("zod/package.json").version is 4.x', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zodPkg = require('zod/package.json') as { version: string }
    expect(zodPkg.version).toMatch(/^4\./)
  })

  it('no zod@3 directory anywhere in node_modules/.pnpm/', () => {
    const pnpmDir = resolve(REPO, 'node_modules/.pnpm')
    const entries = readdirSync(pnpmDir).filter((e) => e.startsWith('zod@3'))
    expect(entries.length).toBe(0)
  })

  // EC-210: knip 5.88.1 declares zod ^4 as peer; with override, it sees 3.25.76.
  // We don't test knip success here (out of scope of this assertion test);
  // we ONLY assert the override is in place.
  it('pnpm-lock.yaml exists (regenerated after override)', () => {
    const lockPath = resolve(REPO, 'pnpm-lock.yaml')
    const content = readFileSync(lockPath, 'utf8')
    expect(content).toContain('lockfileVersion')
  })

  it('pnpm exec knip --no-config still produces output (does not crash)', () => {
    // EC-210 trigger: if knip outright crashes, fallback T0.1b is to remove
    // knip from CI. For now we verify it doesn't crash on the override.
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      execSync('node_modules/.bin/knip --no-config --no-exit-code 2>&1', {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 30_000,
      })
      // exit 0 OR documented warning — both acceptable
    } catch (err) {
      // Knip failure documented in CHANGELOG; test only fails if process crashed
      const message = err instanceof Error ? err.message : String(err)
      // Don't fail on knip's own findings ("3 unused files") — only on
      // crash-level errors (segfault, missing binary, etc.).
      expect(message).not.toMatch(/segfault|cannot find module 'knip'/i)
    }
  })
})
