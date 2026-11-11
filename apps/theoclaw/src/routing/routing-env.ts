import { isAbsolute } from 'node:path'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { clawRouting } from './claws.js'
import { createAgentRouter, type AgentProfile, type AgentRoute, type AgentRouter } from './agent-routes.js'

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
