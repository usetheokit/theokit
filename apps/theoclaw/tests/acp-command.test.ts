import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import { afterEach, describe, expect, it } from 'vitest'

import { createAcpCommandHook, createAcpSessions, type AcpSessions } from '../src/channels/acp-command.js'
import { tempCwd } from './tool-start-fixtures.js'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'permission-asking-acp-agent.mjs')
const GONE_MS = 5_000

const cleanups: (() => void)[] = []
const open: AcpSessions[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((sessions) => sessions.stopAll()))
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + GONE_MS
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function setup(owner = true): { say: (text: string) => Promise<string | undefined>; pidFile: string; sessions: AcpSessions } {
  const cwd = tempCwd(cleanups)
  const pidFile = join(cwd, 'agent.pid')
  const sessions = createAcpSessions({
    agents: [{ name: 'coder', description: 'a coder', command: process.execPath, args: [FIXTURE, `--pid-file=${pidFile}`] }],
    cwd,
  })
  open.push(sessions)
  const hook = createAcpCommandHook({ sessions, isOwner: () => owner })
  const say = async (text: string): Promise<string | undefined> => {
    const decision = await hook.pre_inbound?.({ event: { text } as MessageEvent } as never)
    return decision !== undefined && 'message' in decision ? decision.message : undefined
  }
  return { say, pidFile, sessions }
}

describe('/acp (B-685)', () => {
  it('starts a session, lists it and stops it, leaving no agent process', async () => {
    const { say, pidFile } = setup()
    expect(await say('/acp list')).toBe('No ACP session is running.')
    expect(await say('/acp start coder')).toBe('Started coder as acp-1.')
    await waitFor(() => existsSync(pidFile), 'the agent to start')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(alive(pid)).toBe(true)
    expect(await say('/acp list')).toBe('acp-1 coder')
    expect(await say('/acp stop acp-1')).toBe('Stopped acp-1.')
    await waitFor(() => !alive(pid), 'the agent process to end')
    expect(await say('/acp list')).toBe('No ACP session is running.')
    expect(await say('/acp stop acp-1')).toBe('No ACP session acp-1 is running.')
  })

  it('refuses a non-owner, an unknown agent and a bare command, starting nothing', async () => {
    const stranger = setup(false)
    expect(await stranger.say('/acp start coder')).toBe('Only an owner can do that.')
    expect(stranger.sessions.list()).toEqual([])
    const owner = setup()
    expect(await owner.say('/acp start nobody')).toBe('Unknown ACP agent. Configured: coder.')
    expect(await owner.say('/acp')).toContain('/acp start <agent>')
    expect(owner.sessions.list()).toEqual([])
  })

  it('leaves other messages to the model', async () => {
    expect(await setup().say('/acpx start coder')).toBeUndefined()
  })

  it('stopAll ends every running process', async () => {
    const { say, pidFile, sessions } = setup()
    await say('/acp start coder')
    await waitFor(() => existsSync(pidFile), 'the agent to start')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await sessions.stopAll()
    await waitFor(() => !alive(pid), 'the agent process to end')
    expect(sessions.list()).toEqual([])
  })
})
