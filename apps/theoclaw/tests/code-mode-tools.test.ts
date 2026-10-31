import { mkdirSync, writeFileSync } from 'node:fs'
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

/** A workspace with the default (read-only) tools, a state file, and a file inside the tool root. */
function readOnlyWorkspace(): { readonly workspace: string; readonly settings: ToolSettings } {
  const handle = makeHostToolsWorkspace()
  cleanups.push(() => handle.remove())
  const workspace = handle.path
  mkdirSync(join(workspace, '.theoclaw'), { recursive: true })
  writeFileSync(join(workspace, '.theoclaw', 'x'), 'state')
  const settings = resolveToolSettings({}, workspace, { detect: enforced, ...quiet })
  writeFileSync(join(settings.toolRoot, 'notes.txt'), 'inside the root')
  return { workspace, settings }
}

describe('vetoToolCall', () => {
  it('vetoToolCall refuses a path into .theoclaw and passes a path in the tool root', () => {
    const { settings } = readOnlyWorkspace()

    expect(vetoToolCall('read_file', { path: '../.theoclaw/x' }, settings)).toMatch(/\.theoclaw/)
    expect(vetoToolCall('read_file', { path: 'notes.txt' }, settings)).toBeUndefined()
  })

  it('refuses a malformed argument instead of throwing', () => {
    const { settings } = readOnlyWorkspace()

    expect(vetoToolCall('read_file', { path: 'bad\u0000name' }, settings)).toMatch(/malformed/)
    expect(vetoToolCall('read_file', 'not an object', settings)).toMatch(/malformed/)
  })
})
