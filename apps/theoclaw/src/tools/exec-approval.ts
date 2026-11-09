import { mkdirSync, readFileSync } from 'node:fs'
import { open, rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { PreToolCallContext } from '@theokit/sdk'

import { describeError } from '../control-plane/errors.js'
import type { GeneralPlugin } from './general-plugin.js'

const FILE_NAME = 'exec-approvals.json'
/** The tools that start a command: `interactive_shell` is held to the same decision as `shell_exec`. */
const EXEC_TOOLS: readonly string[] = ['shell_exec', 'interactive_shell']

/** The commands the person approved to run again without being asked, kept in the state directory. */
export interface ExecApprovalStore {
  /** True only for a command spelled exactly as one the person saved; the approval holds wherever that command runs. */
  has(command: string): boolean
  /** Saved on disk before it counts; rejects when the file cannot be written. */
  add(command: string): Promise<void>
}

function load(path: string): Set<string> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw new Error(`${path} cannot be read: ${describeError(error)}`)
  }
  let parsed: { approved?: unknown }
  try {
    parsed = JSON.parse(text) as { approved?: unknown }
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${describeError(error)}); fix or remove it`)
  }
  const list = parsed?.approved
  if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')) {
    throw new Error(`${path} is not an exec approvals file ({ "approved": [...] }); fix or remove it`)
  }
  return new Set(list as string[])
}

/** Load synchronously (an unreadable file stops the start), write through a 0600 temporary file. */
export function createExecApprovalStore(dir: string): ExecApprovalStore {
  const path = join(dir, FILE_NAME)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const approved = load(path)
  let writes: Promise<unknown> = Promise.resolve()
  const save = async (command: string): Promise<void> => {
    const temporary = `${path}.tmp`
    const handle = await open(temporary, 'w', 0o600)
    try {
      await handle.chmod(0o600)
      await handle.writeFile(`${JSON.stringify({ approved: [...new Set([...approved, command])] }, null, 2)}\n`)
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
    approved.add(command)
  }
  return {
    has: (command) => approved.has(command),
    add(command) {
      const next = writes.then(() => save(command))
      writes = next.catch(() => undefined)
      return next
    },
  }
}

/** A model reviewer's verdict: `allow` skips the prompt, `deny` refuses, `ask` leaves it to the person. */
export type ReviewerVerdict = 'allow' | 'deny' | 'ask'
/** The person's answer: run once, run and remember, or refuse. */
export type PersonAnswer = 'once' | 'always' | 'deny'

/** Which agent ran the command, so a chat asker finds the session's chat. */
export interface ExecCall {
  readonly agentId?: string
}

export interface ExecApprovalOptions {
  readonly store: ExecApprovalStore
  /** Asked before the person; a throw or an unknown verdict counts as `ask`. */
  readonly reviewer?: (command: string) => Promise<ReviewerVerdict>
  /** Asks the person in the chat. Absent: a command nothing approved is refused. */
  readonly ask?: (command: string, call?: ExecCall) => Promise<PersonAnswer>
  /** True when the call's session waived the question (`/elevated on`): the command runs unasked. */
  readonly waived?: (call?: ExecCall) => boolean
}

export interface ExecDecision {
  readonly allowed: boolean
  readonly reason: string
}

/** Standing approval first, then the reviewer, then the person. Never throws. */
export function createExecApproval(options: ExecApprovalOptions): (command: string, call?: ExecCall) => Promise<ExecDecision> {
  const { store, reviewer, ask, waived } = options
  return async (command, call) => {
    if (waived?.(call) === true) return { allowed: true, reason: 'elevated mode waives the approval' }
    if (store.has(command)) return { allowed: true, reason: 'a saved approval matches' }
    if (reviewer !== undefined) {
      let verdict: ReviewerVerdict = 'ask'
      try {
        verdict = await reviewer(command)
      } catch {
        verdict = 'ask' // A reviewer failure falls back to the person.
      }
      if (verdict === 'deny') return { allowed: false, reason: 'the reviewer denied it' }
      if (verdict === 'allow') return { allowed: true, reason: 'the reviewer allowed it' }
    }
    if (ask === undefined) return { allowed: false, reason: 'nobody can approve it' }
    let answer: PersonAnswer
    try {
      answer = await ask(command, call)
    } catch {
      return { allowed: false, reason: 'the question could not be asked' }
    }
    if (answer === 'deny') return { allowed: false, reason: 'the person refused it' }
    if (answer === 'always') {
      try {
        await store.add(command)
      } catch {
        // Run this once; the approval is simply not remembered.
      }
    }
    return { allowed: true, reason: 'the person approved it' }
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
        const decision = await decide(command, { agentId: call.agentId })
        return decision.allowed ? undefined : { block: true, message: `theoclaw: exec refused: ${decision.reason}` }
      })
    },
  }
}
