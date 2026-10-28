import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { checkHostToolsPosture, resolveToolSettings } from '../src/tools/tool-settings.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced } from './tool-start-fixtures.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function hostToolSettings(): ToolSettings {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  return resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, workspace.path, { detect: enforced, warn: () => undefined })
}

function refusal(run: () => void): TheoClawConfigError {
  try {
    run()
  } catch (error) {
    if (error instanceof TheoClawConfigError) return error
    throw error
  }
  throw new Error('the posture check did not refuse')
}

describe('checkHostToolsPosture with protected paths', () => {
  it('refuses a protected path inside the tool root, naming its variable', () => {
    const settings = hostToolSettings()
    const path = join(settings.toolRoot, 'state')
    const error = refusal(() => checkHostToolsPosture(settings, [{ path, variable: 'THEOCLAW_STATE_DIR' }]))
    expect(error.variable).toBe('THEOCLAW_STATE_DIR')
    expect(error.message).toContain(`lies under ${settings.toolRoot}`)
  })

  it('accepts a protected path outside every root the shell can write', () => {
    const settings = hostToolSettings()
    const path = join(settings.workspace, 'state')
    expect(() => checkHostToolsPosture(settings, [{ path, variable: 'THEOCLAW_STATE_DIR' }])).not.toThrow()
  })
})
