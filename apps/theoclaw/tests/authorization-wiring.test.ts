import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { PlatformName } from '@theokit/gateway'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { PlatformBuild } from '../src/channels/channel-loop.js'
import { composeTheoClaw } from '../src/composition.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { FakeAdapter, FakeAgent, assistant, finished, messageEvent, waitFor } from './fakes.js'

const APP = resolve(import.meta.dirname, '..')
const DEPCRUISE = resolve(APP, '../../node_modules/.bin/depcruise')
const RULE = 'channels-must-not-import-authorization'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theoclaw-wiring-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Builders for fake adapters on `platforms`, whatever the environment configured, counting builds. */
function fakePlatforms(platforms: readonly PlatformName[]) {
  const adapters = new Map<PlatformName, FakeAdapter>()
  let built = 0
  const builders = (): PlatformBuild[] =>
    platforms.map((platform) => ({
      platform,
      build: () => {
        built += 1
        const adapter = new FakeAdapter(platform)
        adapters.set(platform, adapter)
        return adapter
      },
    }))
  return { adapters, builders, built: () => built }
}

describe('the owner policy hook in the composed app', () => {
  it('every runner the channel loop starts carries the owner policy hook', async () => {
    const platforms = fakePlatforms(['telegram', 'discord', 'slack'])
    let agentsBuilt = 0
    const { loop } = composeTheoClaw({
      env: { THEOCLAW_OWNERS: 'telegram:owner', THEOCLAW_STATE_DIR: dir },
      agentFactory: () => {
        agentsBuilt += 1
        return new FakeAgent({ frames: [assistant('an answer'), finished()] })
      },
      builders: platforms.builders,
      write: () => undefined,
    })
    await loop.ready
    expect(loop.started.size).toBe(3)
    for (const [platform, adapter] of platforms.adapters) {
      await adapter.deliver(messageEvent(platform, 'hello', 'stranger'))
    }
    await waitFor(
      () => [...platforms.adapters.values()].every((adapter) => adapter.sent.length === 1),
      2000,
      'a pairing code on every platform',
    )
    expect(agentsBuilt).toBe(0)
    for (const adapter of platforms.adapters.values()) expect(adapter.sent[0]?.text).toMatch(/^Pairing code: \d{6}\./)
    await loop.stopAll()
  })

  it('a start without THEOCLAW_OWNERS stops before any runner is built', () => {
    const platforms = fakePlatforms(['telegram'])
    let error: unknown
    try {
      composeTheoClaw({
        env: { THEOCLAW_STATE_DIR: dir },
        agentFactory: () => new FakeAgent({ frames: [] }),
        builders: platforms.builders,
        write: () => undefined,
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(TheoClawConfigError)
    expect((error as TheoClawConfigError).variable).toBe('THEOCLAW_OWNERS')
    expect(platforms.built()).toBe(0)
  })
})

interface CruiseReport {
  summary: { violations: { rule: { name: string } }[] }
  modules: { source: string; dependencies: { resolved: string; couldNotResolve: boolean }[] }[]
}

describe('the channels-to-authorization boundary', () => {
  // Two depcruise runs over a fresh tree; 60 s, as B-416's arming test allows.
  it('a channels module importing authorization fails the boundary check', { timeout: 60_000 }, () => {
    // A throwaway tree shaped like the app, so the rule's relative paths match (src/channels/...).
    mkdirSync(join(dir, 'src/channels'), { recursive: true })
    mkdirSync(join(dir, 'src/authorization'), { recursive: true })
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'nodenext' } }))
    writeFileSync(join(dir, 'src/authorization/policy.ts'), 'export const policy = 1\n')
    writeFileSync(join(dir, 'src/channels/probe.ts'), "import { policy } from '../authorization/policy.js'\nexport const probe = policy\n")
    const base = ['src', '--config', join(APP, '.dependency-cruiser.cjs'), '--output-type']
    const json = spawnSync(DEPCRUISE, [...base, 'json'], { cwd: dir, encoding: 'utf8' })
    const err = spawnSync(DEPCRUISE, [...base, 'err'], { cwd: dir, encoding: 'utf8' })
    expect(json.status, `depcruise did not run: ${json.stderr}`).toBe(0)
    const report = JSON.parse(json.stdout) as CruiseReport
    const probe = report.modules.find((module) => module.source === 'src/channels/probe.ts')
    // An unresolved import would pass every rule unread.
    expect(probe?.dependencies.map((dependency) => [dependency.resolved, dependency.couldNotResolve])).toEqual([
      ['src/authorization/policy.ts', false],
    ])
    expect(report.summary.violations.map((violation) => violation.rule.name)).toEqual([RULE])
    expect(err.status).not.toBe(0)
    expect(err.stdout + err.stderr).toContain(RULE)
  })
})
