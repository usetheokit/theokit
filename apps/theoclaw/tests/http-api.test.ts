import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { vetoToolCall } from '../src/tools/path-veto.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'

const enforced = () => ({ ok: true as const, bin: '/usr/bin/bwrap' })
const quiet = { warn: () => undefined }

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function toolSettings(hostTools: boolean): ToolSettings {
  const handle = makeHostToolsWorkspace()
  cleanups.push(() => handle.remove())
  mkdirSync(join(handle.path, '.theoclaw'), { recursive: true })
  return resolveToolSettings(hostTools ? { THEOCLAW_HOST_TOOLS: 'on' } : {}, handle.path, { detect: enforced, ...quiet })
}

describe('vetoToolCall', () => {
  it('is the plugin judgement: a refusal for the state directory, nothing for the tool root', () => {
    const settings = toolSettings(false)

    expect(vetoToolCall('read_file', { path: '../.theoclaw/x' }, settings)).toMatch(/^theoclaw: .*\.theoclaw directory$/)
    expect(vetoToolCall('read_file', { path: 'notes.txt' }, settings)).toBeUndefined()
    expect(vetoToolCall('read_file', { paths: 'x' }, settings)).toMatch(/^theoclaw: refused a malformed tool call: .*paths must be an array/)
  })
})
