import { TheokitAgentError } from '@theokit/agents'

export const DELEGATION_CAP_MS = 15 * 60_000

class DelegationExpiredError extends TheokitAgentError {
  override readonly name = 'DelegationExpiredError'

  constructor(capMs: number) {
    super(
      `[delegation_timeout] the delegation to delegate_to_team exceeded ${String(Math.round(capMs / 60_000))} min and was abandoned. ` +
        'The member agents were disposed of; work already written to disk was NOT reverted — ' +
        'inspect the tree before retrying.',
      { isRetryable: false, code: 'delegation_timeout' },
    )
  }
}

export async function withDelegationCap<T>(
  work: Promise<T>,
  capMs: number = DELEGATION_CAP_MS,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => {
      const t = setTimeout(r, ms)
      if (typeof t === 'object' && 'unref' in t) t.unref()
    }),
): Promise<T> {
  return Promise.race([
    work,
    sleep(capMs).then((): never => {
      throw new DelegationExpiredError(capMs)
    }),
  ])
}
