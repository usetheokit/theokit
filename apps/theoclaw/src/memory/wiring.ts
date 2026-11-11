import type { AgentOptions, CustomTool } from '@theokit/sdk'

import type { TurnAgent, TurnMessage, TurnRun } from '../agent-port.js'
import { untrustedContentSendOptions } from '../agent/untrusted-content.js'
import type { MemoryBackend } from './backend.js'
import { MemoryStore, OWNER_SCOPE, recallSectionOf } from './memory-store.js'
import { saveMemoryTool, sessionSearchTool } from './memory-tools.js'
import { afterTurn, agentReviewer, type RunReviewer } from './turn-review.js'

type Disposable = TurnAgent & { dispose?(): Promise<void> }

/** The memory of one instance: the shared store, and what puts it behind every surface's agents. */
export interface MemoryWiring {
  readonly store: MemoryStore
  /** The tools an agent of any surface gets. */
  readonly tools: readonly CustomTool[]
  /** `agent` whose finished turns are recorded under `surface` and then reviewed in the background. */
  wrap<A extends TurnAgent>(agent: A, surface: string, sessionKey: string, openReviewer: () => Promise<Disposable>): A
  /** The facts section a new session opens with: the backend's when one is selected and answers, else the built-in store's. */
  recall(scope?: string): Promise<string>
  /** Agent options the selected backend adds to every agent (empty for the built-in store). */
  agentOptions(): Promise<Partial<AgentOptions>>
  /** Resolves once every review started so far has ended. */
  idle(): Promise<void>
}

/** Off with `THEOCLAW_MEMORY=off`, and always under incognito, which keeps nothing. */
export function memoryEnabled(env: Readonly<Record<string, string | undefined>>, incognito: boolean): boolean {
  return !incognito && env.THEOCLAW_MEMORY?.trim().toLowerCase() !== 'off'
}

/** The options of the reviewer fork: the session's, with only `save_memory` and no plugin. */
export function reviewerOptions(store: MemoryStore, base: AgentOptions, scope?: string): AgentOptions {
  return { ...base, tools: [saveMemoryTool(store, scope)], plugins: [] }
}

function textOf(message: TurnMessage): string {
  return typeof message === 'string' ? message : message.text
}

export function createMemory(dir: string, report: (line: string) => void, backend?: MemoryBackend): MemoryWiring {
  const store = new MemoryStore(dir)
  const remote = backend?.remote
  if (remote !== undefined) {
    store.onFact = (fact, scope) => {
      remote.write(fact, scope).catch((error: unknown) => report(`theoclaw: memory backend ${remote.id} write failed: ${String(error)}`))
    }
  }
  // One review at a time: a busy chat never fans out into a crowd of model calls.
  let tail: Promise<void> = Promise.resolve()
  const enqueue = (work: () => Promise<void>): void => {
    // A failure of `work` must not poison the turns queued after it.
    tail = tail.then(work).catch((error: unknown) => report(`theoclaw: memory review failed: ${String(error)}`))
  }
  const wrapRun = (run: TurnRun, message: string, surface: string, sessionKey: string, reviewer: RunReviewer): TurnRun => {
    let recorded = false
    return new Proxy(run, {
      get(target, property) {
        if (property === 'wait') {
          return async () => {
            const result = await target.wait()
            if (!recorded && result.status !== 'error' && typeof result.result === 'string') {
              recorded = true
              const turn = {
                surface,
                sessionKey,
                user: message,
                assistant: result.result,
                at: new Date().toISOString(),
              }
              enqueue(() => afterTurn(store, turn, reviewer, (error) => report(`theoclaw: memory review failed: ${String(error)}`)))
            }
            return result
          }
        }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })
  }
  return {
    store,
    tools: [sessionSearchTool(store)],
    agentOptions: () => backend?.agentOptions() ?? Promise.resolve({}),
    async recall(scope) {
      if (remote !== undefined) {
        try {
          const facts = await remote.recall(scope ?? OWNER_SCOPE)
          if (facts.length > 0) return recallSectionOf(facts)
        } catch (error) {
          report(`theoclaw: memory backend ${remote.id} recall failed: ${String(error)}`)
        }
      }
      return store.recallSection(scope)
    },
    wrap(agent, surface, sessionKey, openReviewer) {
      const reviewer = agentReviewer(openReviewer)
      return new Proxy(agent, {
        get(target, property) {
          if (property === 'send') {
            return async (message: TurnMessage, options?: Parameters<TurnAgent['send']>[1]) =>
              wrapRun(await target.send(message, { ...options, ...untrustedContentSendOptions() }), textOf(message), surface, sessionKey, reviewer)
          }
          const value: unknown = Reflect.get(target, property, target)
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
        },
      })
    },
    idle: () => tail,
  }
}
