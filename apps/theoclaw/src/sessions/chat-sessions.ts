import { AsyncLocalStorage } from 'node:async_hooks'
import { rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import { Agent } from '@theokit/sdk'
import type { AgentOptions, Plugin } from '@theokit/sdk'

import { createMemory, type MemoryWiring, memoryEnabled, reviewerOptions } from '../memory/wiring.js'
import { createContainer } from '../agent-container.js'
import { createChannelAgentFactory, isIncognito, sessionAgentOptions } from '../control-plane/agent-factory.js'
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
  /** Plugins every session agent is opened with (B-572: the exec approval gate), read when an agent opens. */
  readonly plugins?: () => readonly Plugin[]
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
export function chatSessions(options: ChatSessionsOptions): { readonly sessions: SessionAgents; readonly withAgent: ChatBoundary; readonly keyOf: (event: MessageEvent) => string; readonly memory: MemoryWiring | undefined } {
  const settings = options.sessionSettings ?? readSessionSettings(options.env, statSync)
  const router = createSessionRouter(settings)
  const incognito = isIncognito(options.env)
  const open = options.getOrCreate ?? ((id: string, agentOptions: AgentOptions) => Agent.getOrCreate(id, agentOptions))
  const memory = memoryEnabled(options.env, incognito) ? createMemory(join(settings.workspace, '.theoclaw', 'memory'), options.write) : undefined
  let reviews = 0
  const recalled = recalledPrompt(memory)
  const sessions = new SessionAgents({
    router,
    // Opened by the chat path's own factory, whose protected options are applied last, so the
    // `shell` withholding and memory off hold whatever `optionsFor` returns (B-377 option A). Only
    // those keys are re-pinned, `local` merged so the session's cwd and the hook gate both hold (B-397).
    getOrCreate: async (id, sessionOptions) => {
      const dir = sessionOptions.local?.sessionDir
      const build = (agentId: string, extra: AgentOptions): Promise<SessionAgent> =>
        createChannelAgentFactory(options.env, (channel) =>
          open(agentId, { ...sessionOptions, ...channel, ...extra, ...recalled(channel.systemPrompt, extra), local: { ...sessionOptions.local, ...channel.local } }),
        )()
      try {
        const opened = await build(id, {})
        // The reviewer is a fork: its own agent id and only `save_memory`, opened after each turn.
        const agent = memory === undefined ? opened : memory.wrap(opened, surfaceOf(id), keyOf(id), () => build(`${id}-review-${++reviews}`, reviewerOptions(memory.store, sessionOptions)))
        return incognito ? withIncognitoCleanup(agent, dir) : agent
      } catch (error) {
        if (incognito) removeIncognitoDir(dir)
        throw error
      }
    },
    optionsFor: () => {
      const base = sessionAgentOptions(options.env, settings.workspace)
      const plugins = options.plugins?.() ?? []
      return plugins.length === 0 ? base : { ...base, plugins: [...(base.plugins ?? []), ...plugins] }
    },
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
  return { sessions, memory, keyOf: (event) => router.resolveAgentId(event), withAgent: (event, work) => currentEvent.run(event, () => boundary.withAgent(work)) }
}

/** The session key inside an agent id (`agentIdFor`), and the surface (platform) its first segment names. */
const keyOf = (id: string): string => id.replace(/^theoclaw-/, '').replace(/-g\d+$/, '')
const surfaceOf = (id: string): string => keyOf(id).split('-')[0] ?? 'chat'

/**
 * A session's agent opens with the facts earlier sessions kept, as data (OC-56); the reviewer fork
 * (which passes `tools`) does not. Read when the agent opens, so a new session sees the latest.
 */
function recalledPrompt(memory: MemoryWiring | undefined) {
  return (prompt: string, extra: AgentOptions): { systemPrompt?: string } => {
    const facts = memory?.store.recallSection() ?? ''
    return facts === '' || extra.tools !== undefined ? {} : { systemPrompt: `${prompt}\n\n${facts}` }
  }
}

/** An incognito agent whose private transcript directory is removed once it is disposed. */
export function withIncognitoCleanup(agent: SessionAgent, dir: string | undefined): SessionAgent {
  return new Proxy(agent, {
    get(target, property) {
      if (property === 'dispose') {
        return async (): Promise<void> => {
          try {
            await target.dispose()
          } finally {
            removeIncognitoDir(dir)
          }
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}

/** Only a directory under the temp root is ever removed, whatever `dir` holds. */
function removeIncognitoDir(dir: string | undefined): void {
  if (dir !== undefined && resolve(dir).startsWith(resolve(tmpdir()) + sep)) rmSync(dir, { recursive: true, force: true })
}
