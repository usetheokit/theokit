import { AsyncLocalStorage } from 'node:async_hooks'
import { rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import { Agent } from '@theokit/sdk'
import type { AgentOptions, Plugin } from '@theokit/sdk'

import { isAuthenticatedSender, senderKey } from '../authorization/policy.js'
import { OWNER_SCOPE } from '../memory/memory-store.js'
import { memoryBackend } from '../memory/backend.js'
import {
  createMemory,
  type MemoryWiring,
  memoryEnabled,
  reviewerOptions,
} from '../memory/wiring.js'
import { createContainer } from '../agent-container.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import {
  createChannelAgentFactory,
  isIncognito,
  keepsTranscripts,
  sessionAgentOptions,
} from '../control-plane/agent-factory.js'
import type { AgentToolOptions } from '../tools/tool-registry.js'
import { SessionRouter } from '@theokit/gateway'
import { MAIN_AGENT, readAgentRouter } from '../routing/routing-env.js'
import { Generations } from './generations.js'
import type { ThinkingLevel } from '../agent/failover.js'
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
  /** The tools and plugins a session opened for `event` holds (a tool profile); absent or undefined: none. */
  readonly toolsFor?: (event: MessageEvent) => AgentToolOptions | undefined
  readonly write: (line: string) => void
}

/** Where the session generations are kept. */
export function sessionsFile(workspace: string): string {
  return join(workspace, '.theoclaw', 'sessions.json')
}

/** The chat path's request boundary: it holds the request's event and leases that session's agent. */
export type ChatBoundary = <R>(
  event: MessageEvent,
  work: (lease: SessionLease) => R | Promise<R>,
) => Promise<R>

/**
 * The chat path's sessions and the request boundary over them. `@theokit/di-agent`'s factory takes
 * no argument and `runInRequest` takes no seed, so the event reaches the factory through an
 * `AsyncLocalStorage` set around the request: per request, which a shared variable would not be
 * once two sessions are dispatched at once. The lease the boundary resolves carries no dispose, so
 * the end of the request leaves the agent open (D2).
 */
export function chatSessions(options: ChatSessionsOptions): {
  readonly sessions: SessionAgents
  readonly withAgent: ChatBoundary
  readonly keyOf: (event: MessageEvent) => string
  /** Set the session's thinking level; its agent is rebuilt for the next turn. */
  readonly think: (event: MessageEvent, level: ThinkingLevel) => void
  readonly memory: MemoryWiring | undefined
} {
  const settings = options.sessionSettings ?? readSessionSettings(options.env, statSync)
  const agentRouter = readAgentRouter(options.env, settings.workspace)
  const baseRouter = createSessionRouter(settings)
  // A routed agent keeps its own sessions even where the DM scope would share one with the main agent.
  const router =
    agentRouter === undefined
      ? baseRouter
      : new SessionRouter((event) => {
          const agent = agentRouter.route({ platform: event.platform, peer: event.sender.id }).id
          return `${baseRouter.resolveAgentId(event)}${agent === MAIN_AGENT ? '' : `-as-${agent}`}`
        })
  const incognito = isIncognito(options.env)
  const transient = incognito || !keepsTranscripts(options.env)
  const open =
    options.getOrCreate ??
    ((id: string, agentOptions: AgentOptions) => Agent.getOrCreate(id, agentOptions))
  if (!incognito && transient && options.env.THEOCLAW_MEMORY?.trim().toLowerCase() === 'on') {
    throw new TheoClawConfigError(
      'THEOCLAW_MEMORY=on needs THEOCLAW_TRANSCRIPTS=on: memory recalls from the chat transcripts, and with transcripts off none is kept',
      {
        variable: 'THEOCLAW_MEMORY',
      },
    )
  }
  const memory = memoryEnabled(options.env, transient)
    ? createMemory(
        join(settings.workspace, '.theoclaw', 'memory'),
        options.write,
        memoryBackend(options.env, settings.workspace),
      )
    : undefined
  let reviews = 0
  const owners = ownerKeys(options.env)
  const currentEvent = new AsyncLocalStorage<MessageEvent>()
  const recalled = recalledPrompt(memory)
  const thinking = new Map<string, ThinkingLevel>()
  // Spread after the channel's options, which carry the instance-wide THEOCLAW_THINKING, so the session's level wins.
  const thinkingExtra = (key: string): AgentOptions & { thinking?: ThinkingLevel } => {
    const level = thinking.get(key)
    return level === undefined ? {} : { thinking: level }
  }
  const sessions = new SessionAgents({
    router,
    // Opened by the chat path's own factory, whose protected options are applied last, so the
    // `shell` withholding and memory off hold whatever `optionsFor` returns (B-377 option A). Only
    // those keys are re-pinned, `local` merged so the session's cwd and the hook gate both hold (B-397).
    getOrCreate: async (id, sessionOptions) => {
      const dir = sessionOptions.local?.sessionDir
      const scope = scopeOf(currentEvent.getStore(), owners)
      const facts = await recalled(scope)
      const backendOptions = (await memory?.agentOptions()) ?? {}
      const build = (agentId: string, extra: AgentOptions): Promise<SessionAgent> =>
        createChannelAgentFactory<SessionAgent>(options.env, (channel) =>
          open(agentId, {
            ...sessionOptions,
            ...backendOptions,
            ...channel,
            ...extra,
            // The session's prompt carries the persona; `...channel` would replace it with the bare notice.
            systemPrompt: extra.systemPrompt ?? sessionOptions.systemPrompt ?? channel.systemPrompt,
            ...withFacts(extra.systemPrompt ?? sessionOptions.systemPrompt ?? channel.systemPrompt, extra, facts),
            local: { ...sessionOptions.local, ...channel.local },
          }),
        )()
      try {
        const opened = await build(id, thinkingExtra(keyOf(id)))
        // The reviewer is a fork: its own agent id and only `save_memory`, opened after each turn.
        const agent =
          memory === undefined
            ? opened
            : memory.wrap(opened, surfaceOf(id), keyOf(id), () =>
                build(
                  `${id}-review-${++reviews}`,
                  reviewerOptions(memory.store, sessionOptions, scope),
                ),
              )
        return transient ? withIncognitoCleanup(agent, dir) : agent
      } catch (error) {
        if (transient) removeIncognitoDir(dir)
        throw error
      }
    },
    optionsFor: (event) => {
      // A bound peer or platform is answered by its own agent: that agent's workspace and persona.
      const workspace =
        agentRouter?.route({ platform: event.platform, peer: event.sender.id }).workspace ??
        settings.workspace
      const base = sessionAgentOptions(options.env, workspace)
      const profiled = options.toolsFor?.(event)
      const plugins = [...(options.plugins?.() ?? []), ...(profiled?.plugins ?? [])]
      const withPlugins =
        plugins.length === 0 ? base : { ...base, plugins: [...(base.plugins ?? []), ...plugins] }
      return profiled === undefined ? withPlugins : { ...withPlugins, tools: [...profiled.tools] }
    },
    generations: options.generations ?? Generations.load(sessionsFile(settings.workspace)),
    settings,
    write: options.write,
  })
  const boundary = createContainer<SessionLease>({
    factory: () => {
      const event = currentEvent.getStore()
      if (event === undefined) throw new Error('a chat agent was resolved outside a message')
      return sessions.lease(event)
    },
  })
  return {
    sessions,
    memory,
    keyOf: (event) => router.resolveAgentId(event),
    think: (event: MessageEvent, level: ThinkingLevel) => {
      thinking.set(router.resolveAgentId(event), level)
      sessions.rebuild(event)
    },
    withAgent: (event, work) => currentEvent.run(event, () => boundary.withAgent(work)),
  }
}

/** The session key inside an agent id (`agentIdFor`), and the surface (platform) its first segment names. */
const keyOf = (id: string): string => id.replace(/^theoclaw-/, '').replace(/-g\d+$/, '')
const surfaceOf = (id: string): string => keyOf(id).split('-')[0] ?? 'chat'

/**
 * A session's agent opens with the facts earlier sessions kept, as data (OC-56); the reviewer fork
 * (which passes `tools`) does not. Read when the agent opens, so a new session sees the latest.
 */
function recalledPrompt(memory: MemoryWiring | undefined) {
  return async (scope: string): Promise<string> => (await memory?.recall(scope)) ?? ''
}

function withFacts(prompt: AgentOptions['systemPrompt'], extra: AgentOptions, facts: string): { systemPrompt?: string } {
  return facts === '' || extra.tools !== undefined || typeof prompt !== 'string' ? {} : { systemPrompt: `${prompt}\n\n${facts}` }
}

/** The `platform:senderId` keys `THEOCLAW_OWNERS` names, compared the way the owner policy does. */
function ownerKeys(env: Readonly<Record<string, string | undefined>>): ReadonlySet<string> {
  const keys = (env.THEOCLAW_OWNERS ?? '').split(',').flatMap((entry) => {
    const at = entry.indexOf(':')
    return at < 1 ? [] : [senderKey(entry.slice(0, at).trim(), entry.slice(at + 1).trim())]
  })
  return new Set(keys)
}

/**
 * Whose facts a session reads and writes: an owner's sessions share the owner scope; any other DM
 * sender has a scope of their own, and a group, thread or topic one per channel. Facts never cross scopes.
 */
function scopeOf(event: MessageEvent | undefined, owners: ReadonlySet<string>): string {
  if (event === undefined) return OWNER_SCOPE
  const sender = senderKey(event.platform, event.sender.id)
  if (event.channel.type === 'dm')
    return isAuthenticatedSender(event.platform) && owners.has(sender) ? OWNER_SCOPE : sender
  return `${event.platform}:channel:${event.channel.id}`
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
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

/** Only a directory under the temp root is ever removed, whatever `dir` holds. */
function removeIncognitoDir(dir: string | undefined): void {
  if (dir !== undefined && resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
}
