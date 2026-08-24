/**
 * ADR 0001, applied to the agent surface (usetheokit/theokit#365).
 *
 * `RouteConfig.policy` gave routes one access decision evaluated by both HTTP executors and
 * `callProcedure`. The agent endpoints are dispatched BEFORE route matching
 * (`request-handler.ts` runs `tryServeAgentAux` and `tryServeAgent` ahead of `tryServeApiRoute`),
 * so no `route()`, no `server/middleware/` and no `server/context.ts` ever observed those URLs.
 * The policy existed and did not reach them.
 *
 * ## Why the policy is declared on the agent module and not passed by the caller
 *
 * `mountAgent` already accepted `policy` and `subject` as options. Every production caller invoked
 * it without either, so the evaluator saw `undefined` and admitted everyone — a gate that works
 * perfectly and is never reached. An option nobody passes is not a seam; it is a comment with a
 * type. So the declaration travels WITH the agent:
 *
 * ```ts
 * // agents/support.ts
 * import { requireOwner } from 'theokit/server/define'
 *
 * export const policy = ({ subject, params }) => requireOwner(subject, ownerOf(params.sessionId))
 * export default defineAgent({ ... })
 * ```
 *
 * One declaration covers every endpoint the agent exposes — the run, the thread routes, the
 * approval surface and MCP — because they all reach the same conversation and the same paused
 * tools. `params.endpoint` says which one is being asked for, so a policy that wants to answer
 * them differently can.
 *
 * `'public'` is the other legal value, and it is a decision rather than the absence of one. It is
 * greppable; silence was not.
 *
 * ## Why the refusal does not repeat the policy's reason
 *
 * `requireOwner` distinguishes `'resource has no recorded owner'` from `'subject does not own this
 * resource'`. Echoed to the wire, that pair tells an unauthenticated caller whether a conversation
 * id exists — the enumeration oracle `docs/program/journeys/j08-tenant.md` grades under criterion 2,
 * rebuilt out of the very check added to close the leak. So the reason goes to the server log,
 * where an operator can read it, and the wire gets one fixed sentence that names what the caller
 * must do. The status stays `403`: the decision is taken before any lookup, so `403` is returned
 * identically for an id that exists and one that never did, and a truthful `403` beats a `404`
 * whose truthfulness a reader cannot check (`docs/adr/0002-*`).
 */
import type {
  AccessDecision,
  RoutePolicy,
  RouteSubject,
} from '../../core/contracts/route-policy.js'
import { evaluateRoutePolicy } from '../../core/contracts/route-policy.js'
import { createLogger } from '../observability/logger.js'

/**
 * Which operation on the agent is being asked for.
 *
 * Handed to the policy under `params.endpoint` so one declaration can answer them separately — a
 * conversation is owned by whoever the key names, while a pending approval has no owner the
 * framework records (see the note on `'approvals'` / `'approve'` below).
 */
export type AgentEndpoint =
  | 'run'
  | 'thread-message'
  | 'thread-stream'
  | 'approvals'
  | 'approve'
  | 'mcp'

/** The path-derived facts a policy is given, alongside the parsed body where one exists. */
export interface AgentAccessParams {
  /** The scanned agent's name — the `<name>` in `/api/agents/<name>`. */
  agent: string
  endpoint: AgentEndpoint
  /**
   * The conversation key, when the request names one. This is the value the durable store resumes
   * on, and the reason #365 exists: it arrives from the caller.
   */
  sessionId?: string
  /**
   * The pending approval the request settles, when it settles one.
   *
   * The framework cannot tell a policy who OWNS this approval: the ledger keys by a bare id and
   * records no owner (`approval-registry.ts`). So a policy asked about `'approve'` can decide
   * whether the caller may touch this agent's approvals at all, and cannot decide whether this
   * approval is theirs. That gap is real and is not closed here.
   */
  approvalId?: string
}

/** Resolve the caller's identity, lazily — see `resolveAgentSubject` for why it must be lazy. */
export type AgentSubjectResolver = () => RouteSubject | null | Promise<RouteSubject | null>

/** Thrown when an agent module exports a `policy` that is neither `'public'` nor a function. */
export class AgentPolicyTypeError extends Error {
  constructor(source: string, actual: string) {
    super(
      `Agent "${source}" exports a \`policy\` of type ${actual}. ` +
        `A policy is the string 'public' or a function ({ subject, body, params }) => boolean | AccessDecision. ` +
        `Import \`requireOwner\` from 'theokit/server/define' to write the owner check.`,
    )
    this.name = 'AgentPolicyTypeError'
  }
}

/**
 * Read the access policy an agent module declares.
 *
 * Fail-fast on a wrong shape rather than falling back to "no policy": a module that MEANT to
 * declare one and got the type wrong would otherwise be served wide open, which is the failure
 * class this whole change exists to remove. Absent ⇒ `undefined`, which `evaluateRoutePolicy`
 * treats as "not declared" exactly as it does for a `RouteConfig` built in memory. Absence is
 * refused where the application DECLARES its agents — `scanAgents` fails the build naming the file.
 *
 * The three-valued answer IS the contract, which is why the mixed return type is silenced below:
 * `undefined` is "not declared", `'public'` is "declared open", and a function is "declared
 * conditional". `RoutePolicy` is the framework's own public union, and collapsing it here would
 * erase the distinction ADR 0001 exists to make.
 */
/* eslint-disable-next-line sonarjs/function-return-type -- see the paragraph above */
export function readAgentPolicy(mod: unknown, source: string): RoutePolicy | undefined {
  const declared =
    typeof mod === 'object' && mod !== null ? (mod as { policy?: unknown }).policy : undefined
  if (declared === undefined) return undefined
  if (declared !== 'public' && typeof declared !== 'function') {
    throw new AgentPolicyTypeError(source, declared === null ? 'null' : typeof declared)
  }
  return declared as RoutePolicy
}

const log = createLogger({ context: { scope: 'theokit:agent-access' } })

/**
 * Evaluate an agent endpoint's policy for this caller.
 *
 * The subject is resolved ONLY when a policy exists. An agent declaring `'public'` therefore never
 * pays for the application's `createContext`, which keeps the zero-config path free of a cost it
 * gets nothing for.
 */
export async function admitAgentRequest(
  policy: RoutePolicy | undefined,
  resolveSubject: AgentSubjectResolver | undefined,
  params: AgentAccessParams,
  body?: unknown,
): Promise<AccessDecision> {
  // `undefined` is "not declared" and `'public'` is "declared open". They differ in what they
  // MEAN and not in what they admit, and neither reads the subject — so neither pays for it.
  if (policy === undefined || policy === 'public') return { allowed: true }
  const subject = resolveSubject === undefined ? null : await resolveSubject()
  return evaluateRoutePolicy(policy, { subject, query: undefined, body, params })
}

/**
 * The refusal, once, for every agent endpoint.
 *
 * The `reason` is logged and not returned — see the module header. The message names the thing the
 * caller can act on: an identity the agent's policy admits, established by the application's own
 * `server/context.ts`.
 */
export function agentAccessDenied(decision: AccessDecision, params: AgentAccessParams): Response {
  if (!decision.allowed) {
    log.warn('agent endpoint refused a caller', {
      agent: params.agent,
      endpoint: params.endpoint,
      reason: decision.reason,
    })
  }
  return new Response(
    JSON.stringify({
      error: {
        code: 'FORBIDDEN',
        message:
          `Access denied by the policy exported from agent "${params.agent}". ` +
          `Send the credential your app turns into \`ctx.subject\` in server/context.ts; ` +
          `the server log records which check refused this request.`,
      },
    }),
    { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } },
  )
}
