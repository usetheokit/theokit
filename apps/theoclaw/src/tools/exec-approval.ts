import { mkdirSync } from 'node:fs'

import { createApprovalGate, PermissionStore, type ApprovalLedger } from '@theokit/agents/auth'
import type { PreToolCallContext } from '@theokit/sdk'

import { describeError } from '../control-plane/errors.js'
import type { GeneralPlugin } from './general-plugin.js'

/** The tools that start a command: `interactive_shell` is held to the same decision as `shell_exec`. */
const EXEC_TOOLS: readonly string[] = ['shell_exec', 'interactive_shell']
/** The one tool name a saved approval is keyed on, so it holds for every exec tool. */
const APPROVAL_TOOL = 'exec'

/** The commands the person approved to run again without being asked, kept in the state directory. */
export interface ExecApprovalStore {
  /** The framework's standing-grant store the gate reads and writes. */
  readonly permissions: PermissionStore
  /** The directory the grants are keyed on; the approval holds wherever the command runs. */
  readonly scope: string
  /** True only for a command spelled exactly as one the person saved. */
  has(command: string): boolean
}

/**
 * The store compares commands after collapsing whitespace; the key is percent-encoded so two commands
 * that differ only in spacing stay two approvals.
 */
const encodeCommand = (command: string): string => encodeURIComponent(command)
/** The command of a receipt's query; a receipt written before the framework ledger carries it plain. */
export function commandOfReceipt(record: { readonly query?: { readonly command: string }; readonly command?: string }): string {
  if (record.query === undefined) return record.command ?? ''
  try {
    return decodeURIComponent(record.query.command)
  } catch {
    return record.query.command
  }
}

/**
 * Standing approvals live in `<dir>/.theokit/tool-permissions.json` (the framework store). An
 * unreadable file stops the start. Approvals saved by earlier releases in `exec-approvals.json` are
 * not read: they must be granted again (see the changelog).
 */
export function createExecApprovalStore(dir: string): ExecApprovalStore {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const permissions = new PermissionStore({ home: dir })
  permissions.list()
  if (permissions.lastReadError !== undefined) {
    throw new Error(`${permissions.path} cannot be read: ${describeError(permissions.lastReadError)}; fix or remove it`)
  }
  return {
    permissions,
    scope: dir,
    has: (command) => permissions.isGranted({ tool: APPROVAL_TOOL, scope: dir, command: encodeCommand(command) }),
  }
}

/** A model reviewer's verdict: `allow` skips the prompt, `deny` refuses, `ask` leaves it to the person. */
export type ReviewerVerdict = 'allow' | 'deny' | 'ask'
/** The person's answer: run once, run and remember, or refuse. */
export type PersonAnswer = 'once' | 'always' | 'deny'
/** An answer, optionally with who gave it (`telegram:42`), for the activity ledger. */
export type PersonReply = PersonAnswer | { readonly answer: PersonAnswer; readonly by: string }

/** Which agent ran the command, so a chat asker finds the session's chat. */
export interface ExecCall {
  readonly agentId?: string
}

export interface ExecApprovalOptions {
  readonly store: ExecApprovalStore
  /** Asked before the person; a throw or an unknown verdict counts as `ask`. */
  readonly reviewer?: (command: string) => Promise<ReviewerVerdict>
  /** Asks the person in the chat. Absent: a command nothing approved is refused. */
  readonly ask?: (command: string, call?: ExecCall) => Promise<PersonReply>
  /** True when the call's session waived the question (`/elevated on`): the command runs unasked. */
  readonly waived?: (call?: ExecCall) => boolean
  /** Where each decision is recorded (the framework's `createJsonlLedger`); absent: nothing is recorded. */
  readonly ledger?: ApprovalLedger
}

export interface ExecDecision {
  readonly allowed: boolean
  readonly reason: string
  /** Who or what decided: `person:<id>`, `saved approval`, `reviewer`, `elevated mode`, or `none`. */
  readonly by?: string
}

/** Words for who decided, as the app has always shown them. */
const BY: Readonly<Record<string, string>> = { waiver: 'elevated mode', saved: 'saved approval' }

/** Standing approval first, then the reviewer, then the person. Never throws. */
export function createExecApproval(options: ExecApprovalOptions): (command: string, call?: ExecCall & { readonly name?: string; readonly runId?: string }) => Promise<ExecDecision> {
  const { store, reviewer, ask, waived } = options
  const gate = createApprovalGate({
    ledger: options.ledger,
    store: store.permissions,
    key: (ctx) => ({ tool: APPROVAL_TOOL, scope: store.scope, command: encodeCommand(String(ctx.args.command)) }),
    waived: waived === undefined ? undefined : (ctx) => waived({ agentId: ctx.agentId }),
    reviewer: reviewer === undefined ? undefined : (query) => reviewer(decodeURIComponent(query.command)),
    ask:
      ask === undefined
        ? undefined
        : (query, ctx) => ask(decodeURIComponent(query.command), { agentId: ctx.agentId }),
  })
  return async (command, call) => {
    const decision = await gate.decide({ name: call?.name ?? 'shell_exec', args: { command }, agentId: call?.agentId ?? '', runId: call?.runId ?? 'unknown' } as Parameters<typeof gate.decide>[0])
    return { allowed: decision.allowed, reason: decision.reason, by: BY[decision.by] ?? decision.by }
  }
}

/** A `pre_tool_call` plugin that holds every `shell_exec` and `interactive_shell` call to the decision. */
export function execApprovalPlugin(options: ExecApprovalOptions): GeneralPlugin {
  const decide = createExecApproval(options)
  return {
    kind: 'general',
    name: 'theoclaw-exec-approval',
    version: '1.0.0',
    register: (ctx) => {
      ctx.on('pre_tool_call', async (context: unknown) => {
        const call = (context ?? {}) as Partial<PreToolCallContext>
        if (call.name === undefined || !EXEC_TOOLS.includes(call.name)) return undefined
        const command = (call.args as { command?: unknown } | undefined)?.command
        if (typeof command !== 'string' || command === '') return { block: true, message: 'theoclaw: the command is missing' }
        const decision = await decide(command, { agentId: call.agentId, name: call.name, runId: typeof call.runId === 'string' ? call.runId : undefined })
        return decision.allowed ? undefined : { block: true, message: `theoclaw: exec refused: ${decision.reason}` }
      })
    },
  }
}
