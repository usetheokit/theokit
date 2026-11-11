import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced, runControlTurn, startForTools, stop } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('the /control agent exec gate', () => {
  it('has the exec-approval plugin with host tools on', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const state = makeHostToolsWorkspace()
    cleanups.push(() => state.remove())
    const start = await startForTools({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_STATE_DIR: state.path }, workspace.path, { detect: enforced })
    started.push(start)
    const options = await runControlTurn(start)
    const gate = (options.plugins ?? []).find((plugin) => plugin.name === 'theoclaw-exec-approval')
    expect(gate).toBeDefined()
  })

  it('has no exec gate with host tools off', async () => {
    const state = mkdtempSync(join(tmpdir(), 'theoclaw-state-'))
    cleanups.push(() => rmSync(state, { recursive: true, force: true }))
    const start = await startForTools({ THEOCLAW_STATE_DIR: state }, undefined, { detect: enforced })
    started.push(start)
    const options = await runControlTurn(start)
    expect((options.plugins ?? []).map((plugin) => plugin.name)).not.toContain('theoclaw-exec-approval')
  })
})
