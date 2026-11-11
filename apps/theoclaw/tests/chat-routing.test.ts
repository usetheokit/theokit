import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessageEvent } from '@theokit/gateway'
import type { AgentOptions } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { chatSessions } from '../src/sessions/chat-sessions.js'
import { readAgentRouter } from '../src/routing/routing-env.js'

function dir(persona: string): string {
  const d = mkdtempSync(join(tmpdir(), 'tc-route-'))
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'SOUL.md'), persona)
  return d
}

function event(sender: string): MessageEvent {
  return { id: 'm', platform: 'matrix', sender: { id: sender }, channel: { id: 'dm1', type: 'dm' }, text: 'hi', receivedAt: 0, matrix: { raw: null } } as unknown as MessageEvent
}

describe('agent routing in the chat path', () => {
  it('answers a bound peer with its own agent workspace and the owner with main', async () => {
    const main = dir('MAIN-PERSONA')
    const work = dir('WORK-PERSONA')
    const seen: AgentOptions[] = []
    const chat = chatSessions({
      env: { THEOCLAW_WORKSPACE: main, THEOCLAW_MODEL: 'anthropic/x', THEOKIT_API_KEY: 'k', THEOCLAW_AGENTS: `work=${work}`, THEOCLAW_ROUTES: 'matrix:@peer=work' },
      getOrCreate: async (_id, options) => {
        seen.push(options)
        return { dispose: async () => undefined } as never
      },
      write: () => undefined,
    })
    const peer = await chat.sessions.lease(event('@peer'))
    const owner = await chat.sessions.lease(event('@owner'))
    expect(peer.agentId).not.toBe(owner.agentId)
    expect(seen[0]?.local?.cwd).toBe(work)
    expect(seen[1]?.local?.cwd).toBe(main)
    peer.release()
    owner.release()
  })

  it('refuses a route to an unconfigured agent', () => {
    expect(() => readAgentRouter({ THEOCLAW_ROUTES: 'matrix:@p=ghost' }, '/w')).toThrow(/unconfigured agent/)
  })
})
