/** B-685: the owner starts, lists and stops ACP sessions with `/acp`, leaving no agent process. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { GatewayHook, MessageEvent } from '@theokit/gateway'
import { afterEach, describe, expect, it } from 'vitest'

import { createAcpHook } from '../src/channels/acp-hook.js'
import { type AcpSessions, createAcpSessions } from '../src/tools/acp-sessions.js'
import { messageEvent } from './fakes.js'
import { tempCwd } from './tool-start-fixtures.js'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'permission-asking-acp-agent.mjs')
const PROCESS_GONE_MS = 5_000

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

async function expectGone(pidFile: string): Promise<void> {
  const pid = Number(readFileSync(pidFile, 'utf8'))
  const deadline = Date.now() + PROCESS_GONE_MS
  while (alive(pid)) {
    if (Date.now() > deadline) throw new Error(`process ${String(pid)} still running`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function setup() {
  const cwd = tempCwd(cleanups)
  const pidFile = join(cwd, 'agent.pid')
  const record = join(cwd, 'permissions.log')
  const sessions = createAcpSessions({
    cwd,
    agents: [{ name: 'fixture', description: 'a fixture', command: process.execPath, args: [FIXTURE, `--pid-file=${pidFile}`, `--record=${record}`] }],
  })
  open.push(sessions)
  const hook: GatewayHook = createAcpHook({ sessions, isOwner: (_platform, id) => id === 'owner-1' })
  const say = async (text: string, sender = 'owner-1'): Promise<string | undefined> => {
    const event: MessageEvent = messageEvent('telegram', text, sender)
    const decision = await hook.pre_inbound?.({ event } as never)
    return (decision as { message?: string } | undefined)?.message
  }
  return { say, pidFile, record, sessions }
}

describe('/acp', () => {
  it('starts a session, lists it, talks to it and stops it, leaving no agent process', async () => {
    const { say, pidFile, record } = setup()
    expect(await say('/acp list')).toBe('No ACP sessions.')
    expect(await say('/acp start fixture')).toBe('Started ACP session 1 (fixture).')
    expect(existsSync(pidFile)).toBe(true)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(alive(pid)).toBe(true)
    expect(await say('/acp list')).toBe('1: fixture')
    expect(await say('/acp send 1 hello')).toBe('done')
    expect(readFileSync(record, 'utf8').trim()).toBe('reject-once')
    expect(await say('/acp stop 1')).toBe('Stopped ACP session 1.')
    await expectGone(pidFile)
    expect(await say('/acp list')).toBe('No ACP sessions.')
    expect(await say('/acp stop 1')).toBe('No ACP session 1.')
  })

  it('refuses a sender who is not an owner and an unknown agent, starting nothing', async () => {
    const { say, pidFile } = setup()
    expect(await say('/acp start fixture', 'stranger')).toBe('Only an owner can use /acp.')
    expect(await say('/acp start nope')).toContain('Unknown ACP agent')
    expect(existsSync(pidFile)).toBe(false)
  })

  it('leaves ordinary messages alone', async () => {
    const { say } = setup()
    expect(await say('/acps')).toBeUndefined()
    expect(await say('hello')).toBeUndefined()
  })

  it('stopAll ends every session', async () => {
    const { say, pidFile, sessions } = setup()
    await say('/acp start fixture')
    await sessions.stopAll()
    await expectGone(pidFile)
    expect(sessions.list()).toEqual([])
  })
})
