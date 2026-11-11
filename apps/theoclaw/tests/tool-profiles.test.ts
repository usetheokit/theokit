import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const created = vi.hoisted(() => [] as string[])
vi.mock('@theokit/agents/sandbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@theokit/agents/sandbox')>()
  return {
    ...actual,
    createSandboxBackend: (...args: Parameters<typeof actual.createSandboxBackend>) => {
      created.push(args[0].mode)
      return actual.createSandboxBackend(...args)
    },
  }
})

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { profileToolOptions, readToolProfile } from '../src/tools/tool-profiles.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'

const settings = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'theoclaw-profile-')))
  mkdirSync(dir, { recursive: true })
  const resolved = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access' }, dir, { warn: () => undefined })
  created.length = 0
  return resolved
}
const names = (profile: Parameters<typeof profileToolOptions>[0], shell = true) =>
  profileToolOptions(profile, settings(), () => false, shell).tools.map((tool) => tool.name)

describe('tool profiles', () => {
  it('reads THEOCLAW_TOOL_PROFILE and refuses an unknown name', () => {
    expect(readToolProfile({})).toBeUndefined()
    expect(readToolProfile({ THEOCLAW_TOOL_PROFILE: ' Coding ' })).toBe('coding')
    expect(() => readToolProfile({ THEOCLAW_TOOL_PROFILE: 'root' })).toThrow(TheoClawConfigError)
  })

  it('gives each profile its own tools', () => {
    expect(names('minimal')).toEqual(['read_file', 'list_dir'])
    expect(names('messaging')).toContain('web_fetch')
    expect(names('messaging')).not.toContain('shell_exec')
    expect(names('coding')).toEqual(expect.arrayContaining(['shell_exec', 'write_file']))
    expect(names('full')).toContain('shell_exec')
  })

  it('leaves the shell out when no exec gate exists', () => {
    expect(names('coding', false)).not.toContain('shell_exec')
  })

  it('runs the shell on an unconfined backend only while elevated', async () => {
    const base = settings()
    let elevated = false
    const shell = profileToolOptions('coding', base, () => elevated, true).tools.find((tool) => tool.name === 'shell_exec')!
    await shell.handler({ command: 'echo hi' })
    expect(created).toEqual([])
    elevated = true
    const outside = join(base.workspace, 'outside.txt')
    await shell.handler({ command: `echo hi > ${outside}` })
    expect(created).toEqual(['danger-full-access'])
    expect(existsSync(outside)).toBe(true)
  })
})
