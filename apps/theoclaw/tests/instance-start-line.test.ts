import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startTheoClaw } from '../src/composition.js'
import type { RunningTheoClaw } from '../src/composition.js'
import { applyInstance, resolveInstance } from '../src/instance.js'
import { capturingStream, fakeBuilders, noAgent } from './composition-fixtures.js'

const ENV = {
  THEOCLAW_OWNERS: 'telegram:owner',
  THEOCLAW_DM_POLICY: 'allowlist',
  THEOCLAW_PORT: '0',
  THEOCLAW_MODEL: 'test-model',
  OPENROUTER_API_KEY: 'openrouter-key-value',
  THEOCLAW_MDNS: 'off',
}

/** FR-007 (B-514): the start names the instance in its first stderr line and on its handle. */
describe('the instance start line', () => {
  const running: RunningTheoClaw[] = []
  const homes: string[] = []
  afterEach(async () => {
    for (const app of running.splice(0)) {
      await app.loop.stopAll()
      await app.close()
    }
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  })

  async function start(instance?: ReturnType<typeof resolveInstance>) {
    const stdout = capturingStream()
    const stderr = capturingStream()
    const app = await startTheoClaw({
      env: ENV,
      agentFactory: noAgent,
      builders: fakeBuilders().builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [stdout, stderr],
      ...(instance === undefined ? {} : { instance }),
    })
    running.push(app)
    return { app, firstLine: stderr.text().split('\n')[0] }
  }

  it('the first start line names the instance and the handle carries it', async () => {
    const name = 'abcdefghij-12345'
    // A real home: the start makes the agents' tool root in the profile's workspace (B-382).
    const home = mkdtempSync(join(tmpdir(), 'theoclaw-start-line-'))
    homes.push(home)
    const instance = resolveInstance({ THEOCLAW_PROFILE: name }, { homeDir: home })
    applyInstance(instance, {})
    const profiled = await start(instance)
    expect(profiled.firstLine).toBe(
      `theoclaw-${name}: instance started, profile directory ${home}/.theokit/profiles/${name}`,
    )
    expect(profiled.app.instance.label).toBe(`theoclaw-${name}`)

    const plain = await start()
    expect(plain.firstLine).toBe('theoclaw: instance started, no profile')
    expect(plain.app.instance).toEqual({ label: 'theoclaw', overrides: {} })
  })
})
