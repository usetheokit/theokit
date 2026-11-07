import { resolve } from 'node:path'

import { AcpClient } from '@theokit/agents'
import type { AcpToolConfig, AcpToolTransport } from 'theokit/server/agent'

import { scrubbedAgentTransport } from './acp-transport.js'
import type { AcpAgentConfig } from './external-tools.js'

const ACP_PROTOCOL_VERSION = 1
/** How long one request of a session may wait for the agent when the agent names no timeout. */
const DEFAULT_TIMEOUT_MS = 600_000

/** One ACP session the owner started with `/acp start`. */
export interface AcpSessionInfo {
  readonly id: string
  readonly agent: string
}

/** The ACP sessions of an instance: each one a long-lived agent process the owner starts, lists and stops. */
export interface AcpSessions {
  /** The names of the ACP agents `THEOCLAW_EXTERNAL_TOOLS` declares. */
  agentNames(): readonly string[]
  start(agent: string): Promise<AcpSessionInfo>
  list(): readonly AcpSessionInfo[]
  /** Send `text` to the session and resolve with the agent's reply; rejects for an unknown id. */
  send(id: string, text: string): Promise<string>
  /** Close the session's process and wait for it to exit; false when no such session. */
  stop(id: string): Promise<boolean>
  stopAll(): Promise<void>
}

interface Live {
  readonly info: AcpSessionInfo
  readonly transport: AcpToolTransport
  readonly client: AcpClient
  readonly sessionId: string
  readonly timeoutMs: number
  readonly updates: unknown[]
}

export interface AcpSessionsOptions {
  readonly agents: readonly AcpAgentConfig[]
  /** The directory the agents run in: the tool root. */
  readonly cwd: string
  /** Default: the scrubbed `env -i` transport every ACP tool uses. */
  readonly transportFactory?: (config: AcpToolConfig) => AcpToolTransport
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`the agent did not answer ${what} within ${String(ms)} ms`))
    }, ms)
  })
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer)
  })
}

function agentText(params: unknown, sessionId: string): string | undefined {
  if (!isRecord(params) || params.sessionId !== sessionId || !isRecord(params.update)) return undefined
  const { sessionUpdate, content } = params.update
  if (sessionUpdate !== 'agent_message_chunk' || !isRecord(content)) return undefined
  return content.type === 'text' && typeof content.text === 'string' ? content.text : undefined
}

/** Every permission an agent asks for is refused, as for the ACP tools (B-684 is asking the owner). */
function refusal(params: unknown): unknown {
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : []
  for (const kind of ['reject_once', 'reject_always']) {
    const option: unknown = options.find((o) => isRecord(o) && o.kind === kind)
    if (isRecord(option) && typeof option.optionId === 'string') return { outcome: { outcome: 'selected', optionId: option.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

export function createAcpSessions(options: AcpSessionsOptions): AcpSessions {
  const makeTransport = options.transportFactory ?? scrubbedAgentTransport
  const live = new Map<string, Live>()
  let counter = 0

  const open = async (agent: AcpAgentConfig): Promise<Live> => {
    const timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const transport = makeTransport({
      name: agent.name,
      description: agent.description,
      command: agent.command,
      ...(agent.args === undefined ? {} : { args: [...agent.args] }),
      cwd: options.cwd,
      onPermissionRequest: () => ({ granted: false }),
    })
    try {
      const client = new AcpClient(transport)
      const updates: unknown[] = []
      client.onNotification('session/update', (params) => {
        updates.push(params)
      })
      client.onRequest('session/request_permission', (params) => refusal(params))
      await withTimeout(client.request('initialize', { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: {} }), timeoutMs, 'initialize')
      const created = await withTimeout(client.request('session/new', { cwd: resolve(options.cwd), mcpServers: [] }), timeoutMs, 'session/new')
      if (!isRecord(created) || typeof created.sessionId !== 'string') throw new Error('the agent returned no sessionId')
      counter += 1
      const info = { id: String(counter), agent: agent.name }
      return { info, transport, client, sessionId: created.sessionId, timeoutMs, updates }
    } catch (error) {
      await transport.close?.()
      throw error
    }
  }

  const stop = async (id: string): Promise<boolean> => {
    const session = live.get(id)
    if (session === undefined) return false
    live.delete(id)
    await session.transport.close?.()
    return true
  }

  return {
    agentNames: () => options.agents.map((agent) => agent.name),
    async start(name) {
      const agent = options.agents.find((candidate) => candidate.name === name)
      if (agent === undefined) throw new Error(`no ACP agent is named ${name}`)
      const session = await open(agent)
      live.set(session.info.id, session)
      return session.info
    },
    list: () => [...live.values()].map((session) => session.info),
    async send(id, text) {
      const session = live.get(id)
      if (session === undefined) throw new Error(`no ACP session ${id}`)
      session.updates.length = 0
      const result = await withTimeout(
        session.client.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text }] }),
        session.timeoutMs,
        'session/prompt',
      )
      const reply = session.updates
        .map((params) => agentText(params, session.sessionId))
        .filter((part): part is string => part !== undefined)
        .join('')
      const stopReason = isRecord(result) ? result.stopReason : undefined
      return stopReason === 'end_turn' ? reply : `${reply}\n(the agent stopped the turn: ${String(stopReason)})`.trim()
    },
    stop,
    async stopAll() {
      await Promise.all([...live.keys()].map((id) => stop(id)))
    },
  }
}
