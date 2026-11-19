import { isAbsolute } from 'node:path'

import { createAgentBindings } from '@theokit/gateway'
import type { AgentBindingRule, MessageEvent } from '@theokit/gateway'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { clawRouting } from './claws.js'

/** One binding rule: a platform, or one peer (sender) of it, to an agent. The most specific rule wins. */
export interface AgentRoute {
  readonly agent: string
  readonly platform?: string
  readonly peer?: string
}

export interface AgentProfile {
  readonly id: string
  /** The agent's own workspace directory. */
  readonly workspace: string
}

export interface AgentRouter {
  /** The profile of the agent that must answer a message from `peer` on `platform`. */
  route(message: { readonly platform: string; readonly peer?: string }): AgentProfile
}

/**
 * The gateway's bindings choose the agent; a route names the sender, so the question is asked of a
 * direct message from that sender, as a group message's peer would be its channel instead.
 */
export function createAgentRouter(config: {
  readonly defaultAgent: string
  readonly agents: readonly AgentProfile[]
  readonly routes: readonly AgentRoute[]
}): AgentRouter {
  const profiles = new Map(config.agents.map((profile) => [profile.id, profile]))
  let bindings: ReturnType<typeof createAgentBindings>
  try {
    bindings = createAgentBindings({
      defaultAgent: config.defaultAgent,
      agents: config.agents.map((agent) => agent.id),
      rules: config.routes as readonly AgentBindingRule[],
    })
  } catch (error) {
    const { code, detail } = error as { code?: unknown; detail?: unknown }
    // Any other refusal (an empty rule) keeps the gateway's own message.
    if (code !== 'unknown_agent') throw error
    throw new Error(`routing names an unconfigured agent: ${String(detail)}`)
  }
  return {
    route({ platform, peer }) {
      const event = { platform, sender: { id: peer ?? '' }, channel: { id: '', type: 'dm' } } as unknown as MessageEvent
      return profiles.get(bindings.agentFor(event))!
    },
  }
}

type Env = Readonly<Record<string, string | undefined>>

/** The id of the instance's own agent, the one every unrouted message reaches. */
export const MAIN_AGENT = 'main'

function entries(value: string | undefined): readonly string[] {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
}

function bad(variable: string, detail: string): TheoClawConfigError {
  return new TheoClawConfigError(`${variable} ${detail}`, { variable })
}

/**
 * `THEOCLAW_AGENTS=work=/abs/workspace,family=/abs/other` names the extra agents (each with its own
 * workspace, so its own persona files); `THEOCLAW_ROUTES=matrix:@peer=work,slack=family` binds a
 * platform, or one peer (sender) of it, to an agent. Returns undefined when no route is set.
 */
export function readAgentRouter(env: Env, mainWorkspace: string): AgentRouter | undefined {
  const routeEntries = entries(env.THEOCLAW_ROUTES)
  const claws = clawRouting(env)
  if (routeEntries.length === 0 && claws.routes.length === 0) return undefined
  const agents: AgentProfile[] = [{ id: MAIN_AGENT, workspace: mainWorkspace }]
  for (const entry of entries(env.THEOCLAW_AGENTS)) {
    const at = entry.indexOf('=')
    const id = entry.slice(0, at).trim()
    const workspace = entry.slice(at + 1).trim()
    if (at < 1 || !/^\w+$/.test(id) || id === MAIN_AGENT || !isAbsolute(workspace)) {
      throw bad('THEOCLAW_AGENTS', 'must be <id>=<absolute workspace> pairs separated by commas; the id is not "main"')
    }
    agents.push({ id, workspace })
  }
  for (const claw of claws.agents) {
    if (agents.some((agent) => agent.id === claw.id)) throw bad('THEOCLAW_AGENTS', `names ${claw.id}, which an installed claw already uses`)
    agents.push(claw)
  }
  const routes: AgentRoute[] = routeEntries.map((entry) => {
    const equals = entry.lastIndexOf('=')
    const target = entry.slice(0, equals).trim()
    const colon = target.indexOf(':')
    const platform = colon < 0 ? target : target.slice(0, colon)
    const peer = colon < 0 ? '' : target.slice(colon + 1)
    if (equals < 1 || platform === '' || (colon >= 0 && peer === '')) {
      throw bad('THEOCLAW_ROUTES', 'must be <platform>[:<peer>]=<agent> pairs separated by commas')
    }
    return { agent: entry.slice(equals + 1).trim(), platform, ...(peer === '' ? {} : { peer }) }
  })
  try {
    return createAgentRouter({ defaultAgent: MAIN_AGENT, agents, routes: [...routes, ...claws.routes] })
  } catch (error) {
    throw bad('THEOCLAW_ROUTES', (error as Error).message)
  }
}
