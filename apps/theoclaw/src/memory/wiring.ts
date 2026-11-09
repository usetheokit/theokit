import type { AgentOptions, CustomTool } from '@theokit/sdk'

import type { TurnAgent, TurnMessage, TurnRun } from '../agent-port.js'
import { MemoryStore } from './memory-store.js'
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
  /** Resolves once every review started so far has ended. */
  idle(): Promise<void>
}

/** Off with `THEOCLAW_MEMORY=off`, and always under incognito, which keeps nothing. */
export function memoryEnabled(env: Readonly<Record<string, string | undefined>>, incognito: boolean): boolean {
  return !incognito && env.THEOCLAW_MEMORY?.trim().toLowerCase() !== 'off'
}

/** The options of the reviewer fork: the session's, with only `save_memory` and no plugin. */
export function reviewerOptions(store: MemoryStore, base: AgentOptions): AgentOptions {
  return { ...base, tools: [saveMemoryTool(store)], plugins: [] }
}

function textOf(message: TurnMessage): string {
  return typeof message === 'string' ? message : message.text
}

export function createMemory(dir: string, report: (line: string) => void): MemoryWiring {
  const store = new MemoryStore(dir)
  // One review at a time: a busy chat never fans out into a crowd of model calls.
  let tail: Promise<void> = Promise.resolve()
  const enqueue = (work: () => Promise<void>): void => {
    tail = tail.then(work)
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
              const turn = { surface, sessionKey, user: message, assistant: result.result, at: new Date().toISOString() }
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
    wrap(agent, surface, sessionKey, openReviewer) {
      const reviewer = agentReviewer(openReviewer)
      return new Proxy(agent, {
        get(target, property) {
          if (property === 'send') {
            return async (message: TurnMessage, options?: Parameters<TurnAgent['send']>[1]) =>
              wrapRun(await target.send(message, options), textOf(message), surface, sessionKey, reviewer)
          }
          const value: unknown = Reflect.get(target, property, target)
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
        },
      })
    },
    idle: () => tail,
  }
}
