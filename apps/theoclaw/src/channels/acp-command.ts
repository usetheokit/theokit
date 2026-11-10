import type { GatewayHook, MessageEvent } from '@theokit/gateway'
import type { AcpToolTransport } from 'theokit/server/agent'

import type { AcpAgentConfig } from '../tools/external-tools.js'
import { scrubbedAgentTransport } from '../tools/acp-transport.js'

const HOOK_NAME = 'theoclaw-acp-command'
const MENTION = '(?:(?:<@[^>]+>|@\\S+)\\s+)?'
const ACP_COMMAND = new RegExp(`^${MENTION}/acp(?:@\\S+)?(?:\\s+(.*))?$`, 's')
const USAGE = 'Use /acp start <agent>, /acp list or /acp stop <id>.'

/** One running ACP agent session the owner started. */
export interface AcpSession {
  readonly id: string
  readonly agent: string
  readonly startedAt: number
}

export interface AcpSessionsOptions {
  /** The agents of `THEOCLAW_EXTERNAL_TOOLS`. */
  readonly agents: readonly AcpAgentConfig[]
  /** The tool root the agent runs in. */
  readonly cwd: string
  /** Default: the scrubbed `env -i` transport the ACP tools use. */
  readonly transportFactory?: typeof scrubbedAgentTransport
  readonly now?: () => number
}

/** The ACP agent processes started with `/acp`: one process each, until stopped or until it exits. */
export interface AcpSessions {
  readonly agentNames: readonly string[]
  start(agent: string): AcpSession
  list(): readonly AcpSession[]
  /** Ends the session's process; false when no such session is running. */
  stop(id: string): Promise<boolean>
  stopAll(): Promise<void>
}

export function createAcpSessions(options: AcpSessionsOptions): AcpSessions {
  const factory = options.transportFactory ?? scrubbedAgentTransport
  const now = options.now ?? Date.now
  const running = new Map<string, { readonly session: AcpSession; readonly transport: AcpToolTransport }>()
  let counter = 0
  const stop = async (id: string): Promise<boolean> => {
    const entry = running.get(id)
    if (entry === undefined) return false
    running.delete(id)
    if (entry.transport.close !== undefined) await entry.transport.close()
    return true
  }
  return {
    agentNames: options.agents.map((agent) => agent.name),
    start(name) {
      const agent = options.agents.find((candidate) => candidate.name === name)
      if (agent === undefined) throw new Error(`no ACP agent named ${name}`)
      counter += 1
      const id = `acp-${String(counter)}`
      const transport = factory({
        name: agent.name,
        description: agent.description,
        command: agent.command,
        ...(agent.args === undefined ? {} : { args: [...agent.args] }),
        cwd: options.cwd,
        // No client drives the session: whatever it asks to do is refused.
        onPermissionRequest: () => ({ granted: false }),
      })
      const session: AcpSession = { id, agent: agent.name, startedAt: now() }
      running.set(id, { session, transport })
      // An agent that exits on its own is no longer a session.
      transport.onClose?.(() => {
        running.delete(id)
      })
      return session
    },
    list: () => [...running.values()].map((entry) => entry.session),
    stop,
    async stopAll() {
      await Promise.all([...running.keys()].map(stop))
    },
  }
}

export interface AcpCommandOptions {
  readonly sessions: AcpSessions
  /** Only an owner may start, list or stop a session. */
  readonly isOwner: (event: MessageEvent) => boolean
}

/** `/acp start <agent>`, `/acp list`, `/acp stop <id>`: answered without the model, owners only (B-685). */
export function createAcpCommandHook(options: AcpCommandOptions): GatewayHook {
  const { sessions, isOwner } = options
  const reply = (message: string): { block: true; message: string } => ({ block: true, message })
  return {
    name: HOOK_NAME,
    async pre_inbound({ event }) {
      const match = ACP_COMMAND.exec(event.text.trim())
      if (match === null) return undefined
      if (!isOwner(event)) return reply('Only an owner can do that.')
      const [verb = '', argument = ''] = (match[1] ?? '').trim().split(/\s+/)
      if (verb === 'list') {
        const running = sessions.list()
        return reply(running.length === 0 ? 'No ACP session is running.' : running.map((s) => `${s.id} ${s.agent}`).join('\n'))
      }
      if (verb === 'start') {
        if (!sessions.agentNames.includes(argument)) {
          const names = sessions.agentNames
          return reply(names.length === 0 ? 'No ACP agent is configured (THEOCLAW_EXTERNAL_TOOLS).' : `Unknown ACP agent. Configured: ${names.join(', ')}.`)
        }
        const session = sessions.start(argument)
        return reply(`Started ${session.agent} as ${session.id}.`)
      }
      if (verb === 'stop') {
        return reply((await sessions.stop(argument)) ? `Stopped ${argument}.` : `No ACP session ${argument === '' ? '(give an id)' : argument} is running.`)
      }
      return reply(USAGE)
    },
  }
}
