import { readTurnUsage, type UIMessageLike } from '@theokit/tui'

interface StoreSnapshot {
  status: 'idle' | 'streaming' | 'done' | 'error'
  thread: readonly UIMessageLike[]
  error?: { message: string } | null
}

export interface StoreGoalAgentDeps {
  send: (text: string) => void
  snapshot: () => StoreSnapshot
  pollMs?: number
}

interface WaitResult {
  result?: string
  usage?: { totalTokens: number }
}

function lastAssistantText(thread: readonly UIMessageLike[]): string | undefined {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i]
    if (m.role !== 'assistant') continue
    const text = m.parts
      .filter((p) => (p as { type?: string }).type === 'text')
      .map((p) => (p as { text?: string }).text ?? '')
      .join('')
    return text
  }
  return undefined
}

function lastTurnUsage(thread: readonly UIMessageLike[]): { totalTokens: number } | undefined {
  for (let i = thread.length - 1; i >= 0; i--) {
    const u = readTurnUsage(thread[i])
    if (u !== undefined) return { totalTokens: u.totalTokens }
  }
  return undefined
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function createStoreGoalAgent(deps: StoreGoalAgentDeps): {
  send(prompt: string): Promise<{ wait(): Promise<WaitResult> }>
} {
  const poll = deps.pollMs ?? 120
  return {
    async send(prompt: string) {
      const baselineLen = deps.snapshot().thread.length
      deps.send(prompt)
      return {
        wait: async (): Promise<WaitResult> => {
          for (let i = 0; i < 200; i++) {
            const s = deps.snapshot()
            if (s.status === 'streaming' || s.status === 'error' || s.thread.length > baselineLen)
              break
            await sleep(poll)
          }
          while (true) {
            const s = deps.snapshot()
            if (s.status === 'error') {
              throw new Error(`goal turn failed: ${s.error?.message ?? 'unknown store error'}`)
            }
            if (s.status !== 'streaming') {
              const delta = s.thread.slice(baselineLen)
              return {
                result: lastAssistantText(delta),
                usage: lastTurnUsage(delta),
              }
            }
            await sleep(poll)
          }
        },
      }
    },
  }
}
