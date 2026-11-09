import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { detectBwrap } from '@theokit/agents/sandbox'
import { PtyInteractiveBackend } from '@theokit/agents-pty'
import { InteractiveBackend } from '@theokit/agents/interactive'
import { afterEach, describe, expect, it } from 'vitest'

import { createConfinedInteractive, probeInteractiveShell, withInteractiveShell } from '../src/tools/interactive-shell.js'
import { buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings, toolSettingsForSession } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { notEnforced } from './tool-start-fixtures.js'

const quiet = { warn: () => undefined }
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function workspace(): string {
  const made = makeHostToolsWorkspace()
  cleanups.push(() => made.remove())
  return made.path
}

/** The real host: a PTY and an enforcing bubblewrap. The confinement tests run only where both exist. */
const hostCanConfine = new PtyInteractiveBackend().available() && detectBwrap().ok
const confined = it.runIf(hostCanConfine)

async function waitUntil(condition: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
  return condition()
}

describe('the interactive shell in the session sandbox', () => {
  confined('a session started through the registry writes inside <workspace>/files and not outside it', async () => {
    const cwd = workspace()
    const settings = await withInteractiveShell(resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, cwd, quiet), quiet)
    const tool = buildTools(settings).find((candidate) => candidate.name === 'interactive_shell')
    expect(tool).toBeDefined()
    const inside = join(settings.toolRoot, 'inside.txt')
    const outside = join(settings.workspace, 'outside.txt')
    const command = `sh -c 'echo in > ${inside}; echo out > ${outside}; sleep 1'`
    const result = JSON.parse(String(await tool!.handler({ command, yield_time_ms: 250 }, {} as never))) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(await waitUntil(() => existsSync(inside))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(existsSync(outside)).toBe(false)
    expect(readFileSync(inside, 'utf8')).toBe('in\n')
  })

  confined('the confined shell does not receive the process secrets', async () => {
    const cwd = workspace()
    const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, cwd, quiet)
    const backend = createConfinedInteractive(settings, { ...quiet, processEnv: { PATH: process.env.PATH, MODEL_KEY: 'sekrit' } })
    const marker = join(settings.toolRoot, 'env.txt')
    const { sessionId } = await backend.startInteractive(`env > ${marker}`, { yieldMs: 250 })
    expect(await waitUntil(() => existsSync(marker) && readFileSync(marker, 'utf8').includes('PATH='))).toBe(true)
    expect(readFileSync(marker, 'utf8')).not.toContain('sekrit')
    backend.kill(sessionId)
  })

  it('is registered only when the probe passed: not without host tools, not without an enforced sandbox', async () => {
    const off = resolveToolSettings({}, workspace(), { detect: notEnforced, ...quiet })
    expect((await withInteractiveShell(off, quiet)).interactive).toBeUndefined()
    const unenforced = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access' }, workspace(), quiet)
    const result = await withInteractiveShell(unenforced, quiet)
    expect(result.interactive).toBeUndefined()
    const names = buildTools(result).map((tool) => tool.name)
    expect(names).not.toContain('interactive_shell')
    expect(names).not.toContain('write_stdin')
    expect(result.offLines.join('\n')).toContain('interactive_shell is off')
  })

  it('a probe fails for a backend that lets the session write outside the tool root', async () => {
    const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access' }, workspace(), quiet)
    // danger-full-access wraps nothing: the unconfined backend must not pass.
    const unconfined = createConfinedInteractive(settings, quiet)
    expect(await probeInteractiveShell(settings, unconfined)).toBe(false)
  })

  confined('registers both tools once proven, and a session of another mode does not inherit them', async () => {
    const settings = await withInteractiveShell(resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, workspace(), quiet), quiet)
    const names = buildTools(settings).map((tool) => tool.name)
    expect(names).toContain('interactive_shell')
    expect(names).toContain('write_stdin')
    const other = toolSettingsForSession(settings, { THEOCLAW_SANDBOX_SESSIONS: 'non-main' }, 'main')
    expect(other.interactive).toBeDefined()
    const read = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'read-only' }, workspace(), quiet)
    expect((await withInteractiveShell(read, quiet)).interactive).toBeUndefined()
  })
})


class StubInteractive extends InteractiveBackend {
  startInteractive = () => Promise.resolve({ sessionId: 's', output: '' })
  writeStdin = () => Promise.resolve({ output: '', alive: false })
  kill = () => undefined
}

describe('the registry with a proven interactive shell', () => {
  it('lists interactive_shell and write_stdin only when settings carry a backend, and only with host tools', () => {
    const base = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, workspace(), quiet)
    expect(buildTools(base).map((tool) => tool.name)).not.toContain('interactive_shell')
    const names = buildTools({ ...base, interactive: new StubInteractive() }).map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['interactive_shell', 'write_stdin']))
    const noHost = resolveToolSettings({}, workspace(), { detect: notEnforced, ...quiet })
    expect(buildTools({ ...noHost, interactive: new StubInteractive() }).map((tool) => tool.name)).not.toContain('interactive_shell')
  })
})
