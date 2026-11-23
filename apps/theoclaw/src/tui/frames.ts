import { nextArrival } from '../control-client/control-client.js'

/** A line for the owner that is not text or a tool of the assistant: what TheoClaw adds at the frame level. */
export interface TuiNotice {
  readonly variant: 'warning' | 'error'
  readonly text: string
}

/** The longest session id the instance accepts (`^[A-Za-z0-9_-]{1,64}$`). */
const MAX_SESSION_LENGTH = 64

/** `/new`'s session: `<base>-<n>`, the base shortened so the whole id stays within 64 characters. */
export function nextSessionId(base: string, n: number): string {
  const suffix = `-${n}`
  return `${base.slice(0, MAX_SESSION_LENGTH - suffix.length)}${suffix}`
}

/** Notices the app raises while a turn runs; the stream places each at the point it has reached when it takes it. */
export interface TurnInbox {
  post(n: TuiNotice): void
  /** The posted notices that arrived before `before` (a stamp from `stamp`), oldest first; the rest stay queued. */
  take(before?: number): TuiNotice[]
  /** Resolves once a notice is queued. */
  wait(): Promise<void>
  /** A stamp on the inbox's clock, to order something else's arrival against the posts. */
  stamp(): number
}

export function createTurnInbox(): TurnInbox {
  let queue: { n: TuiNotice; seq: number }[] = []
  let wake: (() => void) | undefined
  return {
    post(n) {
      queue.push({ n, seq: nextArrival() })
      wake?.()
      wake = undefined
    },
    take(before = Number.POSITIVE_INFINITY) {
      const taken = queue.filter((item) => item.seq < before)
      queue = queue.filter((item) => item.seq >= before)
      return taken.map((item) => item.n)
    },
    wait() {
      if (queue.length > 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        wake = resolve
      })
    },
    stamp: nextArrival,
  }
}
