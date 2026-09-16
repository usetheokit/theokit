import type { AgentToolEvent } from '@theokit/tui'

function oneLine(value: string, max = 120): string {
  const flat = value.replace(/\r?\n/g, '⏎')
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * B-027 — the `Blocked <cmd>` rendering was DELETED, not repaired.
 *
 * `vetoReason` detected `{ exitCode: 126, stderr }` and could never fire, on three independent
 * counts: it bailed on `'ok' in p` and every SDK tool result carries `ok`; it read `p.exitCode`
 * where results use `exit_code` (the sibling below gets it right); and nothing in this repository or
 * the SDK produces exit code 126, which is a shell convention this product never emits. Its only
 * consumer populated the WeakMap that the header branch read, so the whole chain was unreachable —
 * a feature that read as protection and provided none.
 *
 * It was not rewired because the correct shape is not known here without guessing. A hook veto is
 * `{ block: true, message }` (`@theokit/sdk` `PreToolCallDecision`), which the SDK "surfaces to the
 * model" — what that becomes on the wire the renderer sees was not measured, and inventing a shape
 * is how the original was written. B-055 carries the wiring with that contract as its evidence.
 */

/**
 * B-027, MEASURED — the shape that comment said could never arrive does arrive.
 *
 * B-027 deleted a `Blocked <cmd>` rendering because its detector keyed on
 * `{ exitCode: 126, stderr }` and, in its words, "nothing in this repository or the SDK produces
 * exit code 126, which is a shell convention this product never emits". It also said the shape a
 * veto takes on the wire "was not measured, and inventing a shape is how the original was written".
 *
 * It has now been measured, by rejecting a real approval in the TUI and dumping the event:
 *
 *     {"kind":"tool","name":"Ran echo probe2","status":"failed",
 *      "output":"{\"stdout\":\"\",\"stderr\":\"Tool 'run_shell' denied by human approver\",
 *                \"exitCode\":126}"}
 *
 * `@theokit/agents@11.0.0` turns a `{block: true, message}` decision into exactly that — camelCase
 * `exitCode`, 126, and the message on `stderr`. So the deleted detector had the RIGHT shape and the
 * wrong conclusion about whether it occurs. Keyed on the message rather than on 126 alone, because
 * 126 is also what a real shell returns for "command not executable" and the two deserve different
 * words.
 */
const DENIED_MARK = 'denied by human approver'

/** The body `shellBody` renders for a rejection — and the mark the header recognises it by. */
export const REJECTED_BODY = 'rejected — nothing ran'

/**
 * Whether this event is a call the human refused.
 *
 * TWO forms are accepted, and the reason is the order the framework applies things in: since
 * usetheokit/theokit-tui#156 the RESULT formatter runs before the header formatter and REPLACES
 * `output`. So by the time the header sees the event, the runtime's raw payload has already become
 * `REJECTED_BODY` — and matching only the raw form silently stopped working the moment the upstream
 * fix landed, which is exactly how it was caught: the body read `rejected — nothing ran` under a
 * header that still said `Ran echo parity-final`.
 *
 * The raw form is kept because `shellBody` only handles `run_shell`; a rejected `apply_patch` or
 * `edit_file` still arrives with the runtime's own payload.
 */
function wasDenied(event: AgentToolEvent): boolean {
  if (event.status !== 'failed') return false
  const output = (event as { output?: unknown }).output
  if (typeof output !== 'string') return false
  return output === REJECTED_BODY || output.includes(DENIED_MARK)
}

/**
 * Ours only. `defaultToolHeader` was composed in as a fallback and then REMOVED, measured.
 *
 * The reasoning that added it was sound and the measurement killed it. This product exposes
 * `git_diff`, `grep`, `list_dir` and `read_file` with no entry below, so they rendered as raw
 * snake_case names, and the toolkit's default answers all four. What that missed is the sentence in
 * `ToolHeaderFormatter`'s own docblock: *explored grouping matches on the (possibly overridden)
 * `name`, so returning a name for a tool listed in `exploreTools` opts that call OUT of the
 * collapse*. All four are in `DEFAULT_EXPLORE_TOOLS`.
 *
 * Measured on three consecutive `read_file` calls:
 *
 *     without a header   ->  explored                              (one block)
 *     with the default   ->  tool/Read | tool/Read | tool/Read     (three cards)
 *
 * So the fallback bought a verb on a card and paid for it with the grouping — and the grouping is
 * the Claude Code shape this product is chasing. Every tool the default could have helped is in the
 * explore set, which makes the trade a pure loss rather than a balance.
 *
 * A tool that is NOT explored and has no entry below still renders its raw name. That is the honest
 * cost of this decision, and the fix for it is an entry here — where the verb can carry the target
 * and the tense, which the tool-agnostic default cannot.
 */
export function formatToolHeader(
  event: AgentToolEvent,
): { name?: string; summary?: string } | undefined {
  const active = event.status === 'running' || event.status === 'pending'
  const input = (event.input ?? {}) as Record<string, unknown>
  const header = HEADERS_BY_TOOL.get(String(event.name))?.(input, active)
  if (header === undefined) return undefined
  if (!wasDenied(event)) return header

  // The past tense was a lie. A rejected call renders `status: "failed"`, and every header here
  // reads that as "not active" and prints `Ran <cmd>` — for a command that never ran. Whether the
  // shell executed is the single fact this line exists to convey.
  return {
    name: deniedName(String(event.name), input),
    summary: 'you rejected this call — nothing ran and nothing changed',
  }
}

/** `Ran x` → `Rejected x`, per tool, so the noun still matches what was refused. */
function deniedName(tool: string, input: Record<string, unknown>): string {
  const cmd = typeof input.command === 'string' ? oneLine(input.command) : ''
  switch (tool) {
    case 'run_shell':
      return `Rejected ${cmd}`.trim()
    case 'interactive_shell':
      return 'Rejected the interactive session'
    case 'write_stdin':
      return 'Rejected the input to the session'
    case 'apply_patch':
      return 'Rejected the patch'
    case 'edit_file':
      return 'Rejected the edit'
    default:
      return `Rejected ${tool}`
  }
}

type Header = { name?: string; summary?: string }

const HEADERS_BY_TOOL: ReadonlyMap<
  string,
  (input: Record<string, unknown>, active: boolean) => Header
> = new Map([
  [
    'run_shell',
    (input, active) => {
      const cmd = typeof input.command === 'string' ? oneLine(input.command) : ''
      return { name: `${active ? 'Running' : 'Ran'} ${cmd}`.trim() }
    },
  ],
  [
    'interactive_shell',
    (input, active) => {
      const cmd = typeof input.command === 'string' ? oneLine(input.command) : ''
      return { name: active ? 'Starting shell session' : 'Started shell session', summary: cmd }
    },
  ],
  [
    'write_stdin',
    (_input, active) => ({ name: active ? 'Writing to session' : 'Wrote to session' }),
  ],
  [
    'current_time',
    (_input, active) => ({ name: active ? 'Checking the time' : 'Checked the time' }),
  ],
  ['update_plan', (_input, active) => ({ name: active ? 'Updating plan' : 'Updated plan' })],
  [
    'edit_file',
    (input, active) => {
      const path = typeof input.path === 'string' ? input.path : 'file'
      return { name: `${active ? 'Editing' : 'Edited'} ${path}`.trim() }
    },
  ],
  [
    'view_image',
    (input, active) => {
      const path = typeof input.path === 'string' ? input.path : 'image'
      return { name: `${active ? 'Viewing' : 'Viewed'} ${path}`.trim() }
    },
  ],
  [
    'apply_patch',
    (input, active) => {
      const patch = typeof input.patch === 'string' ? input.patch : ''
      return {
        name: `${active ? 'Editing' : 'Edited'} ${filesFromV4APatch(patch)}${diffCounts(patch)}`.trim(),
      }
    },
  ],
])

export function formatToolResult(
  event: AgentToolEvent,
  rawResult: unknown,
): { output: string } | undefined {
  const p = parseJsonObject(rawResult)
  if (p === undefined) return undefined
  return BODY_BY_TOOL.get(String(event.name))?.(p)
}

type ParsedResult = Record<string, unknown>

const BODY_BY_TOOL: ReadonlyMap<string, (p: ParsedResult) => { output: string } | undefined> =
  new Map([
    ['interactive_shell', terminalBody],
    ['write_stdin', terminalBody],
    [
      'edit_file',
      (p) => {
        if (p.ok === false) return { output: `edit_file: ${errorText(p)}` }
        if (typeof p.replacements !== 'number') return undefined
        return {
          output: `Applied ${String(p.replacements)} edit${p.replacements === 1 ? '' : 's'}.`,
        }
      },
    ],
    [
      'current_time',
      (p) => {
        if (p.ok === false) return { output: `current_time: ${errorText(p)}` }
        return typeof p.current_time === 'string' ? { output: p.current_time } : undefined
      },
    ],
    [
      'read_file',
      (p) => {
        if (p.ok === false) return { output: `read_file: ${errorText(p)}` }
        return typeof p.content === 'string' ? { output: p.content } : undefined
      },
    ],
    [
      'apply_patch',
      (p) => {
        if (p.ok === false) return { output: `apply_patch: ${errorText(p)}` }
        const files = Array.isArray(p.files_patched)
          ? (p.files_patched as unknown[]).map(String)
          : []
        if (files.length === 0) return { output: 'Applied patch.' }
        return {
          output: `Edited ${String(files.length)} file${files.length === 1 ? '' : 's'}: ${files.join(', ')}`,
        }
      },
    ],
    [
      'grep',
      (p) => {
        if (p.ok === false) return { output: `grep: ${errorText(p)}` }
        if (!Array.isArray(p.matches)) return undefined
        const lines = (
          p.matches as Array<{ file?: unknown; line?: unknown; preview?: unknown }>
        ).map((m) => `${String(m.file ?? '')}:${String(m.line ?? '')}: ${String(m.preview ?? '')}`)
        return { output: lines.length > 0 ? lines.join('\n') : '(no matches)' }
      },
    ],
    ['update_plan', planBody],
    ['run_shell', shellBody],
  ])

function terminalBody(p: ParsedResult): { output: string } | undefined {
  if (p.ok === false) return { output: `error: ${errorText(p)}` }
  return typeof p.output === 'string'
    ? { output: p.output.replace(/\r\n/g, '\n').replace(/\r/g, '') }
    : undefined
}

function planBody(p: ParsedResult): { output: string } | undefined {
  if (p.ok === false || !Array.isArray(p.steps)) return undefined
  const glyph: Record<string, string> = { completed: '✔', in_progress: '▶', pending: '□' }
  const lines = (p.steps as Array<{ step?: unknown; status?: unknown }>).map((s) => {
    const status = typeof s.status === 'string' ? s.status : 'pending'
    return `${glyph[status] ?? '□'} ${typeof s.step === 'string' ? s.step : ''}`
  })
  if (typeof p.explanation === 'string' && p.explanation) lines.unshift(p.explanation)
  if (typeof p.warning === 'string' && p.warning) lines.push(`(note: ${p.warning})`)
  return { output: lines.join('\n') }
}

function shellBody(p: ParsedResult): { output: string } | undefined {
  if (p.ok === false) return { output: `run_shell: ${errorText(p)}` }
  // A rejected call, now that the formatter is reached on the failure path at all
  // (usetheokit/theokit-tui#156 — the override used to be gated on a field an errored part never
  // populates, so the raw payload was printed verbatim). The runtime renders the veto as a shell
  // result with camelCase `exitCode` 126 and the message on `stderr`; `exit_code` below is the
  // snake_case a real shell run uses, and the two are deliberately not merged — 126 from a real
  // shell means "not executable", which deserves different words.
  if (typeof p.stderr === 'string' && p.stderr.includes(DENIED_MARK)) {
    return { output: REJECTED_BODY }
  }
  const body = [p.stdout, p.stderr]
    .map((s) =>
      typeof s === 'string' ? s.replace(/\r\n/g, '\n').replace(/\r/g, '').trimEnd() : '',
    )
    .filter(Boolean)
    .join('\n')
  const code = typeof p.exit_code === 'number' ? p.exit_code : 0
  const suffix = code !== 0 ? `${body ? '\n' : ''}(exit code: ${String(code)})` : ''
  return { output: `${body}${suffix}` || '(no output)' }
}

/**
 * The keys that settle an approval, shown on the card that asks for one.
 *
 * Both references print this and this product printed nothing: Claude Code ends its prompt with
 * `Enter to confirm · Esc to cancel`, Codex with `Press enter to continue`. Here the card offered
 * `❯ 1. Yes / 2. No` and left the user to guess whether to type the digit, press Enter, or press
 * Esc — on a card that is blocking a shell command, which is the worst moment to guess.
 *
 * `Esc` is named as REJECT rather than "cancel" because that is what it does: `PermissionPrompt`
 * documents Esc as yielding the LAST choice's value, and the last choice here is No. Calling it
 * "cancel" would suggest the question goes away, when in fact the tool call is refused.
 */
export const APPROVAL_KEY_HINT = 'Enter to confirm · Esc to reject'

/**
 * The choice labels on a consent card.
 *
 * `PermissionPrompt` defaults to a bare `Yes` / `No`, which names the KEYSTROKE and not the
 * consequence. Both references say what the answer does — Codex: `1. Yes, continue` / `2. No, quit`;
 * Claude Code: `1. Yes, I trust this folder` / `2. No, exit`. On a card that is blocking a shell
 * command against your own checkout, "Yes" alone is the least informative word available.
 *
 * `no` stays LAST because `PermissionPrompt` documents Esc as yielding the last choice's value.
 * Reordering these would silently make Esc approve.
 */
export function approvalChoices(deny: string): readonly { value: string; label: string }[] {
  return [
    { value: 'yes', label: 'Yes, proceed' },
    { value: 'no', label: deny },
  ]
}

export function formatApproval(pending: { toolName: string; input?: unknown }): {
  toolType: string
  command: string
  description?: string
  hint: string
  choices: readonly { value: string; label: string }[]
} {
  const shared = { hint: APPROVAL_KEY_HINT, choices: approvalChoices('No, reject this call') }
  const label = APPROVAL_LABELS.get(pending.toolName)
  if (label !== undefined) {
    return { ...label((pending.input ?? {}) as Record<string, unknown>), ...shared }
  }
  return {
    toolType: 'Tool call',
    command: pending.toolName,
    ...(pending.input !== undefined ? { description: JSON.stringify(pending.input) } : {}),
    ...shared,
  }
}

type ApprovalLabel = { toolType: string; command: string; description?: string }

const APPROVAL_LABELS: ReadonlyMap<string, (input: Record<string, unknown>) => ApprovalLabel> =
  new Map([
    [
      'run_shell',
      (input) => ({
        toolType: 'Run command',
        command: typeof input.command === 'string' ? input.command : '',
      }),
    ],
    [
      'interactive_shell',
      (input) => ({
        toolType: 'Start interactive shell',
        command: typeof input.command === 'string' ? input.command : '',
      }),
    ],
    [
      'write_stdin',
      (input) => {
        const chars = typeof input.input === 'string' ? input.input : ''
        return { toolType: 'Write to session', command: chars.replace(/\n/g, '⏎').slice(0, 80) }
      },
    ],
    [
      'edit_file',
      (input) => ({
        toolType: 'Apply edit',
        command: typeof input.path === 'string' ? input.path : 'file',
      }),
    ],
    [
      'apply_patch',
      (input) => {
        const patch = typeof input.patch === 'string' ? input.patch : ''
        return {
          toolType: 'Apply patch',
          command: filesFromV4APatch(patch),
          description: readablePatch(patch),
        }
      },
    ],
    [
      'web_fetch',
      (input) => ({
        toolType: 'Fetch URL',
        command: typeof input.url === 'string' ? input.url : '',
      }),
    ],
    [
      'web_search',
      (input) => ({
        toolType: 'Web search',
        command: typeof input.query === 'string' ? input.query : '',
      }),
    ],
  ])

function parseJsonObject(raw: unknown): Record<string, unknown> | undefined {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function errorText(p: Record<string, unknown>): string {
  return typeof p.error === 'string' ? p.error : 'failed'
}

/**
 * The patch body as the person approving it needs to read it.
 *
 * `description` used to be the raw V4A text, so the prompt led with `*** Begin Patch` and closed
 * with `*** End Patch` — envelope markers that carry nothing for the decision — while the changed
 * lines had no per-file heading. Observed 2026-09-15 beside two other agents rendering the same
 * change with a file heading and its context.
 *
 * The envelope goes; the content does not. Every line that is not a marker survives verbatim and in
 * order, because the question being answered is "do I want exactly this edit", and any summarising
 * here would answer a different one.
 *
 * A body with no file marker is returned UNCHANGED. It is not V4A, and showing the operator nothing
 * would be worse than showing them the envelope this function exists to remove.
 */
function readablePatch(patch: string): string {
  const VERBS: ReadonlyArray<readonly [string, string]> = [
    ['*** Add File: ', 'Add'],
    ['*** Delete File: ', 'Delete'],
    ['*** Update File: ', 'Update'],
    ['*** Move to: ', 'Move to'],
  ]
  const out: string[] = []
  let sawFile = false
  for (const raw of patch.split('\n')) {
    const line = raw.trim()
    if (line === '*** Begin Patch' || line === '*** End Patch') continue
    const verb = VERBS.find(([marker]) => line.startsWith(marker))
    if (verb) {
      sawFile = true
      if (out.length > 0) out.push('')
      out.push(`${verb[1]} ${line.slice(verb[0].length).trim()}`)
      continue
    }
    out.push(raw)
  }
  return sawFile ? out.join('\n').trim() : patch
}

function filesFromV4APatch(patch: string): string {
  const markers: Array<[string, boolean]> = [
    ['*** Add File: ', false],
    ['*** Delete File: ', false],
    ['*** Update File: ', false],
    ['*** Move to: ', true], // rename → replaces the last file with the destination
  ]
  const files: string[] = []
  for (const raw of patch.split('\n')) {
    const line = raw.trim()
    for (const [marker, isMove] of markers) {
      if (!line.startsWith(marker)) continue
      const name = line.slice(marker.length).trim()
      if (isMove && files.length > 0) files[files.length - 1] = name
      else if (name) files.push(name)
      break
    }
  }
  const uniq = [...new Set(files.filter(Boolean))]
  if (uniq.length === 0) return 'files'
  return uniq.length <= 3
    ? uniq.join(', ')
    : `${uniq.slice(0, 3).join(', ')} +${uniq.length - 3} more`
}

function diffCounts(diff: string | undefined): string {
  if (typeof diff !== 'string' || diff.length === 0) return ''
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return added === 0 && removed === 0 ? '' : ` (+${added} -${removed})`
}
