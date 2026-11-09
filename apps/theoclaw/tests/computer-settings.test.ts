import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { computerLine, readComputer } from '../src/tools/computer-settings.js'
import type { ComputerDeps } from '../src/tools/computer-settings.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'
import { buildXwd } from './xwd-fixtures.js'

const OFF_LINE = 'tools: computer is off (THEOCLAW_COMPUTER unset)'
const POSTURE = { hostTools: true, sandboxMode: 'workspace-write' } as const
const FOUND: ComputerDeps = { findExecutable: () => '/usr/bin/xdotool' }

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-computer-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function framebuffer(bytes: Buffer = buildXwd({ width: 4, height: 1 })): string {
  const path = join(tempDir(), 'Xvfb_screen0')
  writeFileSync(path, bytes)
  return path
}

function onEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { THEOCLAW_COMPUTER: 'on', DISPLAY: ':99', THEOCLAW_COMPUTER_FRAMEBUFFER: framebuffer(), ...overrides }
}

function refusal(action: () => unknown): TheoClawConfigError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error('expected a TheoClawConfigError')
}

describe('THEOCLAW_COMPUTER', () => {
  it('reads the settings of a host that can run the tool', () => {
    const env = onEnv()
    expect(readComputer(env, POSTURE, FOUND)).toEqual({
      display: ':99',
      framebuffer: env.THEOCLAW_COMPUTER_FRAMEBUFFER,
      xdotool: '/usr/bin/xdotool',
    })
  })

  it.each(['yes', 'ON', 'true'])('refuses the value %s, naming the variable and the value', (value) => {
    const error = refusal(() => readComputer({ THEOCLAW_COMPUTER: value }, POSTURE, FOUND))
    expect(error.variable).toBe('THEOCLAW_COMPUTER')
    expect(error.message).toBe(`THEOCLAW_COMPUTER must be "on" or unset, not "${value}"`)
  })

  it.each([
    ['host tools', onEnv(), { hostTools: false, sandboxMode: 'workspace-write' }, FOUND, 'THEOCLAW_HOST_TOOLS'],
    ['read-only', onEnv(), { hostTools: true, sandboxMode: 'read-only' }, FOUND, 'read-only'],
    ['a display', onEnv({ DISPLAY: '' }), POSTURE, FOUND, 'DISPLAY'],
    ['xdotool', onEnv(), POSTURE, { findExecutable: () => undefined }, 'xdotool'],
    ['a framebuffer', onEnv({ THEOCLAW_COMPUTER_FRAMEBUFFER: undefined }), POSTURE, FOUND, 'THEOCLAW_COMPUTER_FRAMEBUFFER'],
  ] as const)('refuses the tool without %s, naming it', (_what, env, posture, deps, named) => {
    const error = refusal(() => readComputer(env, posture, deps))
    expect(error.variable).toBe('THEOCLAW_COMPUTER')
    expect(error.message).toContain(named)
  })

  it('refuses a framebuffer file that is not a supported XWD file, keeping the field', () => {
    const png = framebuffer(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200)]))
    const error = refusal(() => readComputer(onEnv({ THEOCLAW_COMPUTER_FRAMEBUFFER: png }), POSTURE, FOUND))
    expect(error.message).toContain(png)
    expect(error.message).toContain('pixmap_format')
  })

  it('refuses a framebuffer path that is a directory or is missing', () => {
    const dir = tempDir()
    expect(refusal(() => readComputer(onEnv({ THEOCLAW_COMPUTER_FRAMEBUFFER: dir }), POSTURE, FOUND)).message).toContain(dir)
    const missing = join(dir, 'absent')
    expect(refusal(() => readComputer(onEnv({ THEOCLAW_COMPUTER_FRAMEBUFFER: missing }), POSTURE, FOUND)).message).toContain(missing)
  })

  it('finds xdotool as the first executable file on PATH', () => {
    const bin = tempDir()
    mkdirSync(join(bin, 'sub'))
    writeFileSync(join(bin, 'xdotool'), '#!/bin/sh\n', { mode: 0o755 })
    const settings = readComputer({ ...onEnv(), PATH: `/nonexistent:${bin}` }, POSTURE)
    expect(settings?.xdotool).toBe(join(bin, 'xdotool'))
  })

  it('leaves the tool off when unset or empty, with the off line', () => {
    expect(readComputer({}, POSTURE, FOUND)).toBeUndefined()
    expect(readComputer({ THEOCLAW_COMPUTER: '' }, POSTURE, FOUND)).toBeUndefined()
    expect(computerLine(undefined)).toBe(OFF_LINE)
  })

  it('names the display and the framebuffer in the on line', () => {
    expect(computerLine({ display: ':99', framebuffer: '/tmp/x/Xvfb_screen0', xdotool: '/usr/bin/xdotool' })).toBe(
      'tools: computer is on (display :99, framebuffer /tmp/x/Xvfb_screen0)',
    )
  })
})

describe('the tool settings', () => {
  it('leave settings.computer undefined and print the off line when THEOCLAW_COMPUTER is unset', () => {
    const settings = resolveToolSettings({}, tempCwd(cleanups), { detect: () => ({ ok: false, reason: 'no bwrap' }), warn: () => undefined })
    expect(settings.computer).toBeUndefined()
    expect(settings.offLines).toContain(OFF_LINE)
  })

  it('print the computer line on start', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const env: Record<string, string | undefined> = { ...onEnv(), THEOCLAW_HOST_TOOLS: 'on' }
    const result = await startForTools(env, workspace.path, { detect: enforced, computer: FOUND })
    started.push(result)
    expect(result.error).toBeUndefined()
    expect(result.output()).toContain(`tools: computer is on (display :99, framebuffer ${env.THEOCLAW_COMPUTER_FRAMEBUFFER})`)
  })

  it('refuse the start, before any runner, when the host cannot run the tool', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const result = await startForTools({ THEOCLAW_HOST_TOOLS: 'on', ...onEnv({ DISPLAY: undefined }) }, workspace.path, {
      detect: enforced,
      computer: FOUND,
    })
    started.push(result)
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain('DISPLAY')
    expect(result.builds()).toBe(0)
  })
})
