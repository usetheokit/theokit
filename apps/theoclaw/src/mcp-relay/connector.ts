import type { CustomTool } from '@theokit/sdk'

import { readBearerToken } from '../control-plane/bearer.js'
import type { BindEnvironment } from '../control-plane/bind.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { handleMcpRequest } from '../mcp/serve-tools.js'
import type { ToolSettings } from '../tools/tool-settings.js'

/** The instance side of the hosted MCP relay (OC-116): `THEOCLAW_MCP_RELAY_URL` and `_TOKEN`. */
export interface McpRelaySettings {
  readonly url: string
  readonly token: string
}

/** Both variables set switches the connector on; neither set leaves it off; one alone is refused. */
export function readMcpRelaySettings(env: BindEnvironment): McpRelaySettings | undefined {
  const rawUrl = env.THEOCLAW_MCP_RELAY_URL
  const token = readBearerToken(env, 'THEOCLAW_MCP_RELAY_TOKEN')
  if ((rawUrl === undefined || rawUrl === '') && token === undefined) return undefined
  if (rawUrl === undefined || rawUrl === '') {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_URL must be set with THEOCLAW_MCP_RELAY_TOKEN', {
      variable: 'THEOCLAW_MCP_RELAY_URL',
    })
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_URL does not parse', {
      variable: 'THEOCLAW_MCP_RELAY_URL',
    })
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_URL must be https: (or http: on the loopback)', {
      variable: 'THEOCLAW_MCP_RELAY_URL',
    })
  }
  if (token === undefined) {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_TOKEN must be set with THEOCLAW_MCP_RELAY_URL', {
      variable: 'THEOCLAW_MCP_RELAY_TOKEN',
    })
  }
  return { url: rawUrl.replace(/\/$/, ''), token }
}

/** Values the output mask hides. */
export function mcpRelaySecrets(settings: McpRelaySettings | undefined): string[] {
  return settings === undefined ? [] : [settings.token]
}

export interface McpRelayJob {
  readonly id: string
  readonly client?: string
  readonly allowedTools: string[] | null
  readonly body: unknown
}

export interface McpRelayConnectorOptions {
  readonly settings: McpRelaySettings
  /** The `/control` tool set, built fresh per job. */
  readonly controlTools: () => readonly CustomTool[]
  readonly toolSettings: ToolSettings
  readonly log: (line: string) => void
  readonly signal?: AbortSignal
  readonly fetch?: typeof fetch
  /** Backoff bounds in ms; the delay is jittered between half and all of the ceiling. */
  readonly backoffMs?: { readonly min: number; readonly max: number }
  /** Aborted-aware wait, replaceable by tests. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export interface McpRelayConnector {
  /** Aborts the loop and resolves once it has ended. */
  readonly stop: () => Promise<void>
}

const POLL_TIMEOUT_MS = 40_000

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

/** One job answered: the allowed tools only, through the same handler and veto as `/mcp`. */
export async function answerJob(
  job: McpRelayJob,
  tools: readonly CustomTool[],
  toolSettings: ToolSettings,
): Promise<unknown> {
  const allowed = job.allowedTools === null ? undefined : new Set(job.allowedTools)
  const visible = allowed === undefined ? tools : tools.filter((tool) => allowed.has(tool.name))
  const response = await handleMcpRequest(
    visible,
    toolSettings,
    new Request('http://mcp-relay.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job.body),
    }),
  )
  const text = await response.text()
  return text === '' ? null : (JSON.parse(text) as unknown)
}

/** Starts the poll loop; it runs until `stop()` or `options.signal` aborts. */
export function startMcpRelayConnector(options: McpRelayConnectorOptions): McpRelayConnector {
  const controller = new AbortController()
  options.signal?.addEventListener('abort', () => controller.abort())
  if (options.signal?.aborted) controller.abort()
  const { signal } = controller
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? wait
  const { min, max } = options.backoffMs ?? { min: 500, max: 30_000 }
  const headers = {
    authorization: `Bearer ${options.settings.token}`,
    'content-type': 'application/json',
  }
  const post = (path: string, body: unknown): Promise<Response> =>
    doFetch(`${options.settings.url}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]),
    })

  const handle = async (job: McpRelayJob): Promise<void> => {
    let response: unknown
    try {
      response = await answerJob(job, options.controlTools(), options.toolSettings)
    } catch (error) {
      response = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: error instanceof Error ? error.message : 'internal error' },
      }
    }
    const res = await post('/instance/respond', { id: job.id, response })
    if (!res.ok) throw new Error(`respond answered ${res.status}`)
  }

  const run = async (): Promise<void> => {
    let failures = 0
    let connected = false
    while (!signal.aborted) {
      try {
        const res = await post('/instance/poll', {})
        if (!res.ok) throw new Error(`poll answered ${res.status}`)
        const parsed = (await res.json()) as { jobs?: McpRelayJob[] }
        if (!connected) options.log('mcp-relay: connected')
        connected = true
        failures = 0
        for (const job of Array.isArray(parsed.jobs) ? parsed.jobs : []) {
          if (signal.aborted) break
          try {
            await handle(job)
          } catch {
            if (signal.aborted) break
            // The relay re-offers an unanswered job; the next poll carries on.
          }
        }
      } catch {
        if (signal.aborted) break
        if (connected) options.log('mcp-relay: connection lost, retrying')
        connected = false
        failures += 1
        const ceiling = Math.min(max, min * 2 ** Math.min(failures - 1, 16))
        await sleep(Math.round(ceiling / 2 + Math.random() * (ceiling / 2)), signal)
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
