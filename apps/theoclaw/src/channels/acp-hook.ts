import type { GatewayHook, HookDecision } from '@theokit/gateway'

import type { AcpSessions } from '../tools/acp-sessions.js'

const HOOK_NAME = 'theoclaw-acp'
/** Behind an optional leading mention and with Telegram's optional `@botname`, as `/usage`. */
const ACP_COMMAND = /^(?:(?:<@[^>]+>|@\S+)\s+)?\/acp(?:@\S+)?(?:\s+([\s\S]*))?$/

const USAGE = 'Use /acp start <agent>, /acp list, /acp send <id> <text> or /acp stop <id>.'
const NO_AGENTS = 'No ACP agent is configured: name them in THEOCLAW_EXTERNAL_TOOLS (acpAgents).'
const OWNER_ONLY = 'Only an owner can use /acp.'

export interface AcpHookOptions {
  readonly sessions: AcpSessions
  /** Whether the sender is an owner; a paired sender is not enough to run a process on this host. */
  readonly isOwner: (platform: string, senderId: string) => boolean
  /** Masks the text sent back (an agent's reply can carry anything). */
  readonly mask?: (text: string) => string
}

const reply = (message: string): HookDecision => ({ block: true, message })

/**
 * `/acp start|list|send|stop` (B-685): the owner starts, lists and stops ACP agent sessions. Runs
 * after the owner policy, and answers every `/acp` message so the command never becomes a prompt.
 */
export function createAcpHook(options: AcpHookOptions): GatewayHook {
  const { sessions } = options
  const mask = options.mask ?? ((text: string) => text)
  const run = async (command: string, argument: string): Promise<string> => {
    const [id = '', ...rest] = argument.split(/\s+/)
    if (command === 'list') {
      const all = sessions.list()
      return all.length === 0 ? 'No ACP sessions.' : all.map((s) => `${s.id}: ${s.agent}`).join('\n')
    }
    if (command === 'start') {
      if (sessions.agentNames().length === 0) return NO_AGENTS
      const name = id === '' && sessions.agentNames().length === 1 ? sessions.agentNames()[0] : id
      if (name === undefined || !sessions.agentNames().includes(name)) return `Unknown ACP agent. Choose one of: ${sessions.agentNames().join(', ')}.`
      const started = await sessions.start(name)
      return `Started ACP session ${started.id} (${started.agent}).`
    }
    if (command === 'stop') {
      if (id === '') return USAGE
      return (await sessions.stop(id)) ? `Stopped ACP session ${id}.` : `No ACP session ${id}.`
    }
    if (command === 'send') {
      const text = rest.join(' ').trim()
      if (id === '' || text === '') return USAGE
      return (await sessions.send(id, text)) || '(no reply)'
    }
    return USAGE
  }
  return {
    name: HOOK_NAME,
    async pre_inbound({ event }) {
      const match = ACP_COMMAND.exec(event.text.trim())
      if (match === null) return undefined
      if (!options.isOwner(event.platform, event.sender.id)) return reply(OWNER_ONLY)
      const [command = ''] = (match[1] ?? '').trim().split(/\s+/)
      const argument = (match[1] ?? '').trim().slice(command.length).trim()
      try {
        return reply(mask(await run(command, argument)))
      } catch (error) {
        return reply(mask(`ACP failed: ${error instanceof Error ? error.message : String(error)}`))
      }
    },
  }
}
