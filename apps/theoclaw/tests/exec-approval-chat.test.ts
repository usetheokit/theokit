import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import type { AgentOptions } from '@theokit/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOwnerPolicyHook } from '../src/authorization/owner-policy-hook.js'
import { channelHooks } from '../src/channel-hooks.js'
import {
  createChatExecApproval,
  EXEC_APPROVAL_TIMEOUT_MS,
} from '../src/channels/exec-approval-chat.js'
import { createExecApprovalStore, execApprovalPlugin } from '../src/tools/exec-approval.js'
import { agentIdFor } from '../src/sessions/session-agents.js'
import { composeTheoClaw } from '../src/composition.js'
import { fakeBuilders } from './composition-fixtures.js'
import { assistant, FakeAgent, finished, messageEvent, waitFor } from './fakes.js'

const OWNER = 'owner'
const keyOf = (event: MessageEvent): string => `telegram-dm-${event.sender.id}`

function setup(env: Record<string, string> = {}) {
  const sent: string[] = []
  const chat = createChatExecApproval({
    env,
    keyOf,
    isOwner: (event) => event.sender.id.startsWith(OWNER),
    send: async (_event, text) => void sent.push(text),
  })
  const plugin = execApprovalPlugin({
    store: createExecApprovalStore(mkdtempSync(join(tmpdir(), 'chat-exec-'))),
    ...chat.options,
  })
  let handler: ((context: unknown) => Promise<unknown>) | undefined
  void plugin.register({
    on: (_name: string, h: (context: unknown) => Promise<unknown>) => void (handler = h),
  } as never)
  const exec = (sender: string, command: string): Promise<unknown> =>
    handler!({
      name: 'shell_exec',
      args: { command },
      agentId: agentIdFor(`telegram-dm-${sender}`, 0),
      runId: 'r',
    })
  const say = (sender: string, text: string) =>
    chat.hook.pre_inbound!({ event: messageEvent('telegram', text, sender) })
  return { chat, exec, say, sent }
}

afterEach(() => vi.useRealTimers())

describe('chat exec approval', () => {
  it('runs an exec only after /approve in the same session', async () => {
    const { exec, say, sent } = setup()
    await say(OWNER, 'hello')
    let result: unknown = 'pending'
    const run = exec(OWNER, 'ls').then((value) => void (result = value))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(result).toBe('pending')
    expect(sent[0]).toContain('ls')
    expect(await say(OWNER, '/approve')).toEqual({ block: true, message: 'Approved.' })
    await run
    expect(result).toBeUndefined() // undefined: the call is not blocked
  })

  it('refuses on /deny, and an /approve in another session does not release it', async () => {
    const { exec, say } = setup()
    await say(OWNER, 'hi')
    await say('owner2', 'hi')
    const run = exec(OWNER, 'ls')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await say('owner2', '/approve')).toEqual({
      block: true,
      message: 'Nothing is waiting for approval.',
    })
    await say(OWNER, '/deny')
    expect(await run).toMatchObject({ block: true })
  })

  it('refuses after 120 s of silence', async () => {
    vi.useFakeTimers()
    const { exec, say } = setup()
    await say(OWNER, 'hi')
    const run = exec(OWNER, 'ls')
    await vi.advanceTimersByTimeAsync(EXEC_APPROVAL_TIMEOUT_MS)
    expect(await run).toMatchObject({ block: true })
  })

  it('only an owner can approve or switch elevated', async () => {
    const { say } = setup()
    expect(await say('friend', '/approve')).toEqual({
      block: true,
      message: 'Only an owner can do that.',
    })
    expect(await say('friend', '/elevated on')).toEqual({
      block: true,
      message: 'Only an owner can do that.',
    })
  })

  it('/elevated switches one session and leaves another on its own setting', async () => {
    const { exec, say, chat } = setup()
    await say(OWNER, 'hi')
    await say('owner2', 'hi')
    await say(OWNER, '/elevated on')
    expect(chat.elevated(keyOf(messageEvent('telegram', '', OWNER)))).toBe(true)
    expect(await exec(OWNER, 'ls')).toBeUndefined()
    // The other session is still asked, and nobody answers it.
    vi.useFakeTimers()
    const other = exec('owner2', 'ls')
    await vi.advanceTimersByTimeAsync(EXEC_APPROVAL_TIMEOUT_MS)
    expect(await other).toMatchObject({ block: true })
    vi.useRealTimers()
    await say(OWNER, '/elevated off')
    expect(chat.elevated(keyOf(messageEvent('telegram', '', OWNER)))).toBe(false)
  })

  it('THEOCLAW_ELEVATED=on is the default and /elevated off overrides it for one session', async () => {
    const { chat, say } = setup({ THEOCLAW_ELEVATED: 'on' })
    await say(OWNER, '/elevated off')
    expect(chat.elevated(keyOf(messageEvent('telegram', '', OWNER)))).toBe(false)
    expect(chat.elevated(keyOf(messageEvent('telegram', '', 'owner2')))).toBe(true)
  })

  it('lets a waiting exec take the owner bare /approve past the pairing command', async () => {
    const { chat, say, exec } = setup()
    const hooks = channelHooks({
      policy: { owners: new Set(['telegram:owner']), dmPolicy: 'open' } as never,
      write: () => undefined,
      execApproval: chat,
    })
    expect(hooks.map((hook) => hook.name)).toContain('theoclaw-exec-approval-chat')
    await say(OWNER, 'hi')
    const pairing = createOwnerPolicyHook({
      policy: { owners: new Set(['telegram:owner']), dmPolicy: 'open' } as never,
      execPending: chat.hasPending,
    })
    const event = messageEvent('telegram', '/approve', OWNER)
    expect(await pairing.pre_inbound!({ event })).toMatchObject({ block: true }) // nothing waits: the pairing answer
    const run = exec(OWNER, 'ls')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await pairing.pre_inbound!({ event })).toBeUndefined() // an exec waits: passed on to the exec hook
    await say(OWNER, '/approve')
    await run
  })
})

describe('the composed app', () => {
  it('opens each chat session agent with a gate that asks that session and runs the exec only after /approve', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'chat-exec-state-'))
    const workspace = mkdtempSync(join(tmpdir(), 'chat-exec-ws-'))
    const { adapters, builders } = fakeBuilders()
    const opened: { id: string; options: AgentOptions }[] = []
    const { loop, sessions } = composeTheoClaw({
      env: {
        THEOCLAW_OWNERS: 'telegram:user-1',
        THEOCLAW_DM_POLICY: 'open',
        THEOCLAW_TELEGRAM_TOKEN: 'telegram-token-value',
        THEOCLAW_WORKSPACE: workspace,
        THEOCLAW_STATE_DIR: stateDir,
        THEOCLAW_MODEL: 'm',
        OPENROUTER_API_KEY: 'k',
      },
      agentFactory: () => {
        throw new Error('unused')
      },
      getOrCreate: async (id, options) => {
        opened.push({ id, options })
        return Object.assign(new FakeAgent({ frames: [assistant('ok'), finished()] }), { dispose: async () => undefined })
      },
      builders,
      write: () => undefined,
    })
    await loop.ready
    const telegram = adapters.get('telegram')!
    await telegram.deliver(messageEvent('telegram', 'hello'))
    await waitFor(() => telegram.sent.length === 1, 1000, 'the chat reply')

    const plugin = opened[0]!.options.plugins?.find((candidate) => candidate.name === 'theoclaw-exec-approval')
    expect(plugin).toBeDefined()
    let handler: ((context: unknown) => Promise<unknown>) | undefined
    void plugin!.register({ on: (_name: string, h: (context: unknown) => Promise<unknown>) => void (handler = h) } as never)
    let result: unknown = 'pending'
    const run = handler!({ name: 'shell_exec', args: { command: 'ls' }, agentId: opened[0]!.id, runId: 'r' }).then((value) => void (result = value))
    await waitFor(() => telegram.sent.length === 2, 1000, 'the question in the chat')
    expect(result).toBe('pending')
    await telegram.deliver(messageEvent('telegram', '/approve'))
    await run
    expect(result).toBeUndefined()
    await loop.stopAll()
    await sessions.disposeAll()
  })
})
