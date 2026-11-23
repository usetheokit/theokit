import type { RelayJob } from './relay-server.js'

/** A named tool the relay can scope. Anything with a `name` works. */
export interface RelayTool {
  readonly name: string
}

export interface McpRelayConnectorOptions<T extends RelayTool> {
  /** The relay's base URL, without `/mcp`. */
  readonly url: string
  /** The instance token the relay was started with. */
  readonly token: string
  /** The local tools; read per job. */
  readonly tools: () => readonly T[]
  /**
   * Answers one JSON-RPC body from the tools the grant allows (the others are not passed in), e.g.
   * the framework's MCP handler. Return `null` for a notification.
   */
  readonly dispatch: (tools: readonly T[], body: unknown) => Promise<unknown>
  readonly log?: (line: string) => void
  readonly signal?: AbortSignal
  readonly fetch?: typeof fetch
  /** Backoff bounds in ms, jittered between half and all of the ceiling. Default 500..30 000. */
  readonly backoffMs?: { readonly min: number; readonly max: number }
  /** Per-request cap in ms; must exceed the relay's poll window. Default 40 000. */
  readonly requestTimeoutMs?: number
}

export interface McpRelayConnector {
  /** Aborts the loop and resolves once it has ended. */
  readonly stop: () => Promise<void>
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

/** One job answered from the tools its grant allows; scopes are tool names. */
export async function answerRelayJob<T extends RelayTool>(
  job: Pick<RelayJob, 'scopes' | 'body'>,
  tools: readonly T[],
  dispatch: (tools: readonly T[], body: unknown) => Promise<unknown>,
): Promise<unknown> {
  const allowed = new Set(job.scopes)
  return dispatch(
    tools.filter((tool) => allowed.has(tool.name)),
    job.body,
  )
}

/** Starts the poll loop that answers the relay's queued requests; it ends on `stop()` or abort. */
export function startMcpRelayConnector<T extends RelayTool>(
  options: McpRelayConnectorOptions<T>,
): McpRelayConnector {
  const controller = new AbortController()
  options.signal?.addEventListener('abort', () => {
    controller.abort()
  })
  if (options.signal?.aborted) controller.abort()
  const { signal } = controller
  const doFetch = options.fetch ?? fetch
  const { min, max } = options.backoffMs ?? { min: 500, max: 30_000 }
  const base = options.url.replace(/\/$/, '')
  const post = (path: string, body: unknown): Promise<Response> =>
    doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMs ?? 40_000)]),
    })

  const handle = async (job: RelayJob): Promise<void> => {
    let response: unknown
    try {
      response = await answerRelayJob(job, options.tools(), options.dispatch)
    } catch (error) {
      response = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: error instanceof Error ? error.message : 'internal error' },
      }
    }
    // A notification has no answer; the relay already replied 202.
    if (response === null || response === undefined) return
    const res = await post('/instance/respond', { id: job.id, response })
    if (!res.ok && res.status !== 404) throw new Error(`respond answered ${res.status}`)
  }

  const aborted = (): boolean => signal.aborted

  const run = async (): Promise<void> => {
    let failures = 0
    let connected = false
    while (!aborted()) {
      try {
        const res = await post('/instance/poll', {})
        if (!res.ok) throw new Error(`poll answered ${res.status}`)
        const parsed = (await res.json()) as { jobs?: RelayJob[] }
        if (!connected) options.log?.('mcp-relay: connected')
        connected = true
        failures = 0
        for (const job of Array.isArray(parsed.jobs) ? parsed.jobs : []) {
          if (aborted()) break
          try {
            await handle(job)
          } catch {
            // The job's client times out; the loop carries on.
          }
        }
      } catch {
        if (aborted()) break
        if (connected) options.log?.('mcp-relay: connection lost, retrying')
        connected = false
        failures += 1
        const ceiling = Math.min(max, min * 2 ** Math.min(failures - 1, 16))
        // eslint-disable-next-line sonarjs/pseudo-random -- backoff jitter, not security
        await wait(Math.round(ceiling / 2 + Math.random() * (ceiling / 2)), signal)
      }
    }
  }
  const done = run()
  return {
    stop: async () => {
      controller.abort()
      await done
    },
  }
}
