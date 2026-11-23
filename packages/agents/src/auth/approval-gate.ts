import type { Plugin } from '@theokit/sdk'

import type { ApprovalLedger } from './approval-ledger.js'
import type { GrantGateContext } from './permission-gate.js'
import type { PermissionQuery, PermissionStore } from './permission-store.js'

export type PreToolCallContext = GrantGateContext
export type ApprovalAnswer = 'once' | 'always' | 'deny'
export interface ApprovalDecision {
  allowed: boolean
  reason: string
  /** `'waiver' | 'saved' | 'reviewer' | 'person' | 'person:<id>' | 'none'` */
  by: string
}

export interface ApprovalGateOptions {
  /** `'always'` calls `store.grant`. */
  store: PermissionStore
  /** `undefined`: the call is not governed. */
  key: (ctx: PreToolCallContext) => PermissionQuery | undefined
  waived?: (ctx: PreToolCallContext) => boolean
  reviewer?: (query: PermissionQuery) => Promise<'allow' | 'deny' | 'ask'>
  ask?: (
    query: PermissionQuery,
    ctx: PreToolCallContext,
  ) => Promise<ApprovalAnswer | { answer: ApprovalAnswer; by: string }>
  /** How long the person has to answer; a timeout is a deny. */
  timeoutMs?: number
  ledger?: ApprovalLedger
  /** `false`: a call `key` leaves ungoverned writes no receipt. Default `true`. */
  recordUngoverned?: boolean
  /** `false`: an `'always'` answer allows this call only and is not saved. Default `true`. */
  persistAlways?: boolean
  /** The `plugin`'s refusal text; default `"<name>" refused: <reason>`. */
  refusal?: (name: string, reason: string) => string
  onError?: (error: unknown, stage: 'reviewer' | 'ask' | 'save' | 'ledger') => void
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * One decision chain before a risky tool runs: waiver, saved approval, reviewer, then the person
 * (once / always / deny) with a timeout that fails closed. Every decision is receipted to `ledger`.
 * Failures never allow a call; each is reported through `onError` and named in `reason`.
 */
export function createApprovalGate(options: ApprovalGateOptions): {
  decide(ctx: PreToolCallContext): Promise<ApprovalDecision>
  plugin: Plugin
} {
  const report = (error: unknown, stage: 'reviewer' | 'ask' | 'save' | 'ledger'): void => {
    try {
      options.onError?.(error, stage)
    } catch {
      // A throwing error reporter must not turn a decision into a crash.
    }
  }

  const askPerson = async (
    query: PermissionQuery,
    ctx: PreToolCallContext,
    note: string,
  ): Promise<ApprovalDecision> => {
    if (options.ask === undefined) {
      return { allowed: false, reason: `${note}nobody can approve it`, by: 'none' }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const pending = options.ask(query, ctx)
      const raced =
        options.timeoutMs === undefined
          ? pending
          : Promise.race([
              pending,
              new Promise<'timeout'>((resolve) => {
                timer = setTimeout(() => {
                  resolve('timeout')
                }, options.timeoutMs)
              }),
            ])
      const result = await raced
      if (result === 'timeout') {
        // The late answer, if any, must not surface as an unhandled rejection.
        pending.catch(() => undefined)
        return {
          allowed: false,
          reason: `${note}no answer within ${String(options.timeoutMs)}ms, denied`,
          by: 'none',
        }
      }
      const answer: unknown = typeof result === 'string' ? result : result.answer
      const by = typeof result === 'string' ? 'person' : `person:${result.by}`
      if (answer === 'deny') return { allowed: false, reason: `${note}the person denied it`, by }
      if (answer === 'always' && options.persistAlways === false) {
        return { allowed: true, reason: `${note}the person approved once`, by }
      }
      if (answer === 'always') {
        try {
          options.store.grant(query)
        } catch (error) {
          report(error, 'save')
          return {
            allowed: true,
            reason: `${note}the person approved once; saving the approval failed (save: ${message(error)})`,
            by,
          }
        }
        return { allowed: true, reason: `${note}the person approved it and it is saved`, by }
      }
      if (answer === 'once') return { allowed: true, reason: `${note}the person approved once`, by }
      return { allowed: false, reason: `${note}unrecognised answer, denied`, by }
    } catch (error) {
      report(error, 'ask')
      return {
        allowed: false,
        reason: `${note}asking failed (ask: ${message(error)}), denied`,
        by: 'none',
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  const chain = async (
    query: PermissionQuery,
    ctx: PreToolCallContext,
  ): Promise<ApprovalDecision> => {
    if (options.waived?.(ctx) === true) {
      return { allowed: true, reason: 'waived for this session', by: 'waiver' }
    }
    if (options.store.isGranted(query)) {
      return { allowed: true, reason: 'a saved approval matches', by: 'saved' }
    }
    let note = ''
    if (options.reviewer !== undefined) {
      try {
        const verdict = await options.reviewer(query)
        if (verdict === 'allow')
          return { allowed: true, reason: 'the reviewer allowed it', by: 'reviewer' }
        if (verdict === 'deny')
          return { allowed: false, reason: 'the reviewer denied it', by: 'reviewer' }
      } catch (error) {
        report(error, 'reviewer')
        note = `the reviewer failed (reviewer: ${message(error)}), deferred to the person; `
      }
    }
    return askPerson(query, ctx, note)
  }

  const decide = async (ctx: PreToolCallContext): Promise<ApprovalDecision> => {
    let query: PermissionQuery | undefined
    let decision: ApprovalDecision
    try {
      query = options.key(ctx)
      decision =
        query === undefined
          ? { allowed: true, reason: 'not governed', by: 'none' }
          : await chain(query, ctx)
    } catch (error) {
      decision = { allowed: false, reason: `the decision failed: ${message(error)}`, by: 'none' }
    }
    if (
      options.ledger !== undefined &&
      (query !== undefined || options.recordUngoverned !== false)
    ) {
      try {
        await options.ledger.append({
          at: new Date().toISOString(),
          runId: ctx.runId,
          agentId: ctx.agentId,
          tool: ctx.name,
          ...(query === undefined ? {} : { query }),
          allowed: decision.allowed,
          decidedBy: decision.by,
          reason: decision.reason,
        })
      } catch (error) {
        report(error, 'ledger')
        decision = { ...decision, reason: `${decision.reason} (ledger: ${message(error)})` }
      }
    }
    return decision
  }

  const plugin = {
    name: 'theokit-approval-gate',
    version: '1.0.0',
    kind: 'general',
    register(ctx: { on(hook: string, handler: (c: PreToolCallContext) => unknown): void }) {
      ctx.on('pre_tool_call', async (c: PreToolCallContext) => {
        const d = await decide(c)
        return d.allowed
          ? undefined
          : {
              block: true,
              message: options.refusal?.(c.name, d.reason) ?? `"${c.name}" refused: ${d.reason}`,
            }
      })
    },
  } as unknown as Plugin

  return { decide, plugin }
}
