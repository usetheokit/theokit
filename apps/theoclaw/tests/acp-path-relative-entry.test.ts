import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { AcpTransportClosedError } from 'theokit/server/agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { notEnforced, tempCwd } from './tool-start-fixtures.js'

// B-706 (loop-code-review #84/#87): `env` resolves an empty or relative PATH entry against the
// agent's cwd, the model-writable tool root. A file planted there must never run as the agent.
const AGENT = 'theoclaw-b706-probe-agent'

const cleanups: (() => void)[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A `/bin/sh` script that writes `marker` with the shell builtin only, so any PATH lets it write. */
function plant(path: string, marker: string): void {
  writeFileSync(path, `#!/bin/sh\necho ran > '${marker}'\n`)
  chmodSync(path, 0o755)
}

/** A `/bin/sh` script that writes the environment it received to `marker`, through the absolute `env`. */
function plantEnvDumper(path: string, marker: string): void {
  writeFileSync(path, `#!/bin/sh\n/usr/bin/env > '${marker}'\n`)
  chmodSync(path, 0o755)
}

interface Workspace {
  readonly cwd: string
  readonly toolRoot: string
  readonly settingsFile: string
}

/** A TheoClaw workspace whose external tools file names one ACP agent run as `command`. */
function workspace(command: string): Workspace {
  const cwd = tempCwd(cleanups)
  const settingsFile = join(cwd, 'external-tools.json')
  writeFileSync(settingsFile, JSON.stringify({ acpAgents: [{ name: 'asker', description: 'asks', command, args: [], timeoutMs: 5_000 }] }))
  const settings = resolveToolSettings({ THEOCLAW_EXTERNAL_TOOLS: settingsFile }, cwd, { detect: notEnforced, warn: () => undefined })
  return { cwd, toolRoot: settings.toolRoot, settingsFile }
}

/** Call the ACP tool of `space` with `PATH` set to `path` (or unset), returning what the call rejected with. */
async function callAgent(space: Workspace, path: string | undefined): Promise<unknown> {
  vi.stubEnv('PATH', path)
  const settings = resolveToolSettings({ THEOCLAW_EXTERNAL_TOOLS: space.settingsFile }, space.cwd, { detect: notEnforced, warn: () => undefined })
  const tool = buildTools(settings).find((candidate) => candidate.name === 'asker')
  if (tool === undefined) throw new Error('buildTools built no ACP tool named asker')
  // The call settles once the agent's channel closes, so every marker is final after it.
  return Promise.resolve(tool.handler({ message: 'hi' }, undefined as never)).then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** Plant the agent in the tool root (or under it) and in an absolute directory, then call it with `pathFor`'s PATH. */
async function callWith(pathFor: (toolRoot: string, legit: string) => string, plantIn: (toolRoot: string) => string) {
  const space = workspace(AGENT)
  const legit = tempCwd(cleanups)
  const plantedMarker = join(space.cwd, 'planted-ran')
  const legitMarker = join(space.cwd, 'legit-ran')
  const plantDir = plantIn(space.toolRoot)
  mkdirSync(plantDir, { recursive: true })
  plant(join(plantDir, AGENT), plantedMarker)
  plant(join(legit, AGENT), legitMarker)
  await callAgent(space, pathFor(space.toolRoot, legit))
  return { planted: existsSync(plantedMarker), legit: existsSync(legitMarker) }
}

/** The `PATH` lines of the environment an env-dumping agent wrote. */
function pathLines(marker: string): string[] {
  return readFileSync(marker, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('PATH='))
}

function expectRefused(error: unknown): void {
  expect(error).toBeInstanceOf(AcpTransportClosedError)
  expect((error as AcpTransportClosedError).command).toBe(AGENT)
  expect((error as Error).message).toContain(`"${AGENT}" could not be found or run`)
}

describe('an ACP agent named by a bare command (B-706)', () => {
  it('never runs a file planted in the tool root through an empty PATH entry', async () => {
    const ran = await callWith((_root, legit) => `:${legit}`, (root) => root)
    expect(ran.planted).toBe(false)
    expect(ran.legit).toBe(true)
  })

  it('never runs a file planted in the tool root through a "." PATH entry', async () => {
    const ran = await callWith((_root, legit) => `.:${legit}`, (root) => root)
    expect(ran.planted).toBe(false)
    expect(ran.legit).toBe(true)
  })

  it('never runs a file planted under the tool root through a relative "bin" PATH entry', async () => {
    const ran = await callWith((_root, legit) => `bin:${legit}`, (root) => join(root, 'bin'))
    expect(ran.planted).toBe(false)
    expect(ran.legit).toBe(true)
  })

  it('negative: refuses a command only a relative entry holds', async () => {
    const space = workspace(AGENT)
    const empty = tempCwd(cleanups)
    const plantedMarker = join(space.cwd, 'planted-ran')
    plant(join(space.toolRoot, AGENT), plantedMarker)
    const error = await callAgent(space, `.:${empty}`)
    expectRefused(error)
    expect(existsSync(plantedMarker)).toBe(false)
  })

  it('passes the agent the absolute entries only', async () => {
    const space = workspace(AGENT)
    const legit = tempCwd(cleanups)
    const other = tempCwd(cleanups)
    const marker = join(space.cwd, 'agent-env')
    plantEnvDumper(join(legit, AGENT), marker)
    await callAgent(space, `:.:${legit}:bin:${other}`)
    expect(pathLines(marker)).toEqual([`PATH=${legit}:${other}`])
  })

  it('edge: passes no PATH when no entry is absolute', async () => {
    const legit = tempCwd(cleanups)
    const command = join(legit, AGENT)
    const space = workspace(command)
    const marker = join(space.cwd, 'agent-env')
    plantEnvDumper(command, marker)
    await callAgent(space, '.:bin')
    expect(existsSync(marker)).toBe(true)
    expect(pathLines(marker)).toEqual([])
  })

  it('edge: still runs the agent found on an absolute PATH entry', async () => {
    const ran = await callWith((_root, legit) => legit, (root) => join(root, 'unused'))
    expect(ran.legit).toBe(true)
    expect(ran.planted).toBe(false)
  })

  it('negative: skips an absolute entry whose path contains =', async () => {
    const space = workspace(AGENT)
    const withEquals = join(tempCwd(cleanups), 'a=b')
    mkdirSync(withEquals)
    const legit = tempCwd(cleanups)
    const equalsMarker = join(space.cwd, 'equals-ran')
    const legitMarker = join(space.cwd, 'legit-ran')
    plant(join(withEquals, AGENT), equalsMarker)
    plant(join(legit, AGENT), legitMarker)
    await callAgent(space, `${withEquals}:${legit}`)
    expect(existsSync(legitMarker)).toBe(true)
    expect(existsSync(equalsMarker)).toBe(false)
  })

  it('edge: refuses a bare command when PATH is unset', async () => {
    const space = workspace(AGENT)
    const plantedMarker = join(space.cwd, 'planted-ran')
    plant(join(space.toolRoot, AGENT), plantedMarker)
    const error = await callAgent(space, undefined)
    expectRefused(error)
    expect(existsSync(plantedMarker)).toBe(false)
  })

  it("edge: skips a directory of the agent's name on an earlier entry", async () => {
    const space = workspace(AGENT)
    const shadow = tempCwd(cleanups)
    mkdirSync(join(shadow, AGENT))
    const legit = tempCwd(cleanups)
    const legitMarker = join(space.cwd, 'legit-ran')
    plant(join(legit, AGENT), legitMarker)
    await callAgent(space, `${shadow}:${legit}`)
    expect(existsSync(legitMarker)).toBe(true)
  })

  it('edge: still runs an agent given as an absolute command', async () => {
    const legit = tempCwd(cleanups)
    const command = join(legit, AGENT)
    const space = workspace(command)
    const marker = join(space.cwd, 'legit-ran')
    plant(command, marker)
    await callAgent(space, '.:bin')
    expect(existsSync(marker)).toBe(true)
  })

  it('negative: refuses a relative command with a slash even when it exists relative to the process cwd', async () => {
    const { scrubbedAgentTransport } = await import('../src/tools/acp-transport.js')
    const space = workspace(AGENT)
    // Present relative to the process cwd, which the old check used, but not relative to the agent's cwd.
    const dir = mkdtempSync(join(process.cwd(), 'b706-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const marker = join(space.cwd, 'planted-ran')
    plant(join(dir, AGENT), marker)
    const command = join(relative(process.cwd(), dir), AGENT)
    const closed: unknown[] = []
    scrubbedAgentTransport({ name: 'asker', description: 'asks', command, args: [], cwd: space.toolRoot, timeoutMs: 5_000, onPermissionRequest: () => ({ granted: false }) }).onClose?.((error) => closed.push(error))
    // A refused command is reported closed at once; the old code spawned `env` instead.
    expect(closed[0]).toBeInstanceOf(AcpTransportClosedError)
    expect(existsSync(marker)).toBe(false)
  })
})
