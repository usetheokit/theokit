/**
 * `proof-imports-only-published-entry-points` applies to every file its app's CI cruise reads (B-416).
 *
 * The arming probes in `a-proof-import-into-a-package-src-fails-the-boundary-check.test.ts` live in
 * an OS temp directory, so dependency-cruiser sees them as `../../../../tmp/...`. Real app files are
 * cruised as `packages/<pkg>/...` (TheoCode) or `src/...` and `tests/...` (TheoClaw), a path shape
 * no probe has. A `from.pathNot` widened to exempt those prefixes left every probe refused and every
 * real file unguarded: the review of 2026-10-09 measured it, with the whole suite green.
 *
 * This file closes that gap without writing under `apps/` (NFR-005). It reads each app's own config
 * and the cruise roots from the app's own script, lists the tracked files under those roots, and
 * asserts the rule's `from.pathNot` exempts none of them while it still exempts framework modules.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO = resolve(import.meta.dirname, '../..')
const RULE = 'proof-imports-only-published-entry-points'
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/

interface PathCondition {
  path?: string
  pathNot?: string
}
interface ForbiddenRule {
  name: string
  from: PathCondition
  to: PathCondition
}
interface CruiserConfig {
  forbidden: ForbiddenRule[]
  options: { exclude: { path: string } }
}

/** Each app and the package script its CI step runs (`ci.yml`: depcruise, boundaries). */
const APPS: readonly (readonly [app: string, script: string])[] = [
  ['theocode', 'depcruise'],
  ['theoclaw', 'boundaries'],
]

function loadConfig(app: string): CruiserConfig {
  const require = createRequire(import.meta.url)
  return require(join(REPO, 'apps', app, '.dependency-cruiser.cjs')) as CruiserConfig
}

function proofRule(app: string): ForbiddenRule {
  const rule = loadConfig(app).forbidden.find((r) => r.name === RULE)
  if (!rule) throw new Error(`apps/${app}/.dependency-cruiser.cjs declares no ${RULE}`)
  return rule
}

/** The positional arguments of the app's depcruise script: the roots CI actually cruises. */
function cruiseRoots(app: string, script: string): string[] {
  const pkg = JSON.parse(readFileSync(join(REPO, 'apps', app, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const words = (pkg.scripts[script] ?? '').split(/\s+/).filter(Boolean)
  const roots: string[] = []
  for (let i = 1; i < words.length; i++) {
    if (words[i] === '--config') i++
    else if (!words[i]?.startsWith('-')) roots.push(words[i] as string)
  }
  return roots
}

/** Tracked source files under the cruise roots, as the cruise names them (relative to the app). */
function cruisedSources(app: string, script: string): string[] {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git lists the tracked files the cruise reads
  const out = spawnSync('git', ['ls-files', '--', ...cruiseRoots(app, script)], {
    cwd: join(REPO, 'apps', app),
    encoding: 'utf8',
  })
  expect(out.status, `git ls-files failed for ${app}: ${out.stderr}`).toBe(0)
  const exclude = new RegExp(loadConfig(app).options.exclude.path)
  return out.stdout.split('\n').filter((file) => SOURCE.test(file) && !exclude.test(file))
}

describe.each(APPS)('%s: the proof import rule governs the files CI cruises', (app, script) => {
  it(`${app}: the cruise roots come from the ${script} script`, () => {
    expect(cruiseRoots(app, script).length).toBeGreaterThan(0)
  })

  it(`${app}: from.pathNot exempts no tracked file under the cruise roots`, () => {
    const pathNot = new RegExp(proofRule(app).from.pathNot ?? '(?!)')
    const sources = cruisedSources(app, script)

    expect(sources.length).toBeGreaterThan(0)
    expect(sources.filter((file) => pathNot.test(file))).toEqual([])
  })

  it(`${app}: from.pathNot still exempts the framework's own modules`, () => {
    const pathNot = new RegExp(proofRule(app).from.pathNot ?? '(?!)')

    expect(pathNot.test('../../packages/agents/src/index.ts')).toBe(true)
    expect(pathNot.test('node_modules/zod/index.js')).toBe(true)
  })

  it(`${app}: to.path names a package src and not its dist`, () => {
    const to = new RegExp(proofRule(app).to.path ?? '(?!)')

    expect(to.test('../../packages/agents/src/index.ts')).toBe(true)
    expect(to.test('../../packages/agents/dist/index.js')).toBe(false)
  })
})
