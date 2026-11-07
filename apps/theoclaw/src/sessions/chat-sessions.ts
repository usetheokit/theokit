import { AsyncLocalStorage } from 'node:async_hooks'
import { statSync } from 'node:fs'
import { join } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import { Agent } from '@theokit/sdk'
import type { AgentOptions } from '@theokit/sdk'

import { createContainer } from '../agent-container.js'
import { createChannelAgentFactory, sessionAgentOptions } from '../control-plane/agent-factory.js'
import { Generations } from './generations.js'
import { type SessionAgent, SessionAgents, type SessionLease } from './session-agents.js'
import { createSessionRouter } from './session-key.js'
import { readSessionSettings, type SessionSettings } from './session-settings.js'

/** What the chat sessions are built from: the slice of `TheoClawOptions` they read. */
export interface ChatSessionsOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly getOrCreate?: (id: string, options: AgentOptions) => Promise<SessionAgent>
  readonly generations?: Generations
  readonly sessionSettings?: SessionSettings
  readonly write: (line: string) => void
}

/** Where the session generations are kept. */
export function sessionsFile(workspace: string): string {
  return join(workspace, '.theoclaw', 'sessions.json')
}

/** The chat path's request boundary: it holds the request's event and leases that session's agent. */
export type ChatBoundary = <R>(event: MessageEvent, work: (lease: SessionLease) => R | Promise<R>) => Promise<R>

/**
 * The chat path's sessions and the request boundary over them. `@theokit/di-agent`'s factory takes
 * no argument and `runInRequest` takes no seed, so the event reaches the factory through an
 * `AsyncLocalStorage` set around the request: per request, which a shared variable would not be
 * once two sessions are dispatched at once. The lease the boundary resolves carries no dispose, so
 * the end of the request leaves the agent open (D2).
 */
export function chatSessions(options: ChatSessionsOptions): { readonly sessions: SessionAgents; readonly withAgent: ChatBoundary; readonly keyOf: (event: MessageEvent) => string } {
  const settings = options.sessionSettings ?? readSessionSettings(options.env, statSync)
  const router = createSessionRouter(settings)
  const open = options.getOrCreate ?? ((id: string, agentOptions: AgentOptions) => Agent.getOrCreate(id, agentOptions))
  const sessions = new SessionAgents({
    router,
    // Opened by the chat path's own factory, whose protected options are applied last, so the
    // `shell` withholding and memory off hold whatever `optionsFor` returns (B-377 option A). Only
    // those keys are re-pinned, `local` merged so the session's cwd and the hook gate both hold (B-397).
    getOrCreate: (id, sessionOptions) =>
      createChannelAgentFactory(options.env, (channel) => open(id, { ...sessionOptions, ...channel, local: { ...sessionOptions.local, ...channel.local } }))(),
    optionsFor: () => sessionAgentOptions(options.env, settings.workspace),
    generations: options.generations ?? Generations.load(sessionsFile(settings.workspace)),
    settings,
    write: options.write,
  })
  const currentEvent = new AsyncLocalStorage<MessageEvent>()
  const boundary = createContainer<SessionLease>({
    factory: () => {
      const event = currentEvent.getStore()
      if (event === undefined) throw new Error('a chat agent was resolved outside a message')
      return sessions.lease(event)
    },
  })
  return { sessions, keyOf: (event) => router.resolveAgentId(event), withAgent: (event, work) => currentEvent.run(event, () => boundary.withAgent(work)) }
}
