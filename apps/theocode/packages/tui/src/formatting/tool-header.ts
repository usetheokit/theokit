import { toolPresentation, type AgentToolEvent } from '@theokit/tui'

function oneLine(value: string, max = 120): string {
  const flat = value.replace(/\r?\n/g, '⏎')
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * A refused call arrives with a typed `refusal` (`@theokit/tui` `ToolRefusal`), so nothing here reads
 * the result text or an exit code to decide that a call was refused. `human` and `timeout` read as
 * `Rejected`, `policy` and `hook` as `Blocked` — the toolkit's own split.
 */
function refusalVerb(refusal: NonNullable<AgentToolEvent['refusal']>): 'Rejected' | 'Blocked' {
  return refusal.by === 'human' || refusal.by === 'timeout' ? 'Rejected' : 'Blocked'
}

/**
 * Ours only. Tools with no entry below return `undefined`, so the toolkit's own header (and, for
 * `GitDiff`, `Grep`, `Glob` and `Read`, its `explored` grouping) applies untouched.
 *
 * `defaultToolHeader` was once composed in as a fallback and removed: it gave those four tools a verb
 * but lost the explored block. Whether a call joins that block is decided by the event's `explore`
 * flag (only `explore: false` opts a call out, see `messages-to-events`), not by the header's `name`;
 * the removal is kept because every tool the default could have helped is in the explore set and this
 * product wants the collapsed shape.
 *
 * A tool that is NOT explored and has no entry below still renders its raw name. The fix for that is
 * an entry here, where the verb can carry the target and the tense.
 */
export function formatToolHeader(
  event: AgentToolEvent,
): { name?: string; summary?: string } | undefined {
  const active = event.status === 'running' || event.status === 'pending'
  const input = (event.input ?? {}) as Record<string, unknown>
  const header = HEADERS_BY_TOOL.get(String(event.name))?.(input, active)
  if (header === undefined) return undefined
  const { refusal } = event
  if (refusal === undefined) return header

  // The past tense would be a lie: a refused call renders `status: "failed"`, and every header here
  // reads that as "not active" and prints `Ran <cmd>` for a command that never ran.
  const verb = refusalVerb(refusal)
  return {
    name: refusedName(verb, String(event.name), input),
    summary:
      verb === 'Rejected'
        ? 'you rejected this call — nothing ran and nothing changed'
        : 'refused before it ran — nothing ran and nothing changed',
  }
}

/** `Ran x` → `Rejected x` / `Blocked x`, per tool, so the noun still matches what was refused. */
function refusedName(
  verb: 'Rejected' | 'Blocked',
  tool: string,
  input: Record<string, unknown>,
): string {
  const cmd = typeof input.command === 'string' ? oneLine(input.command) : ''
  switch (tool) {
    case 'Bash':
      return `${verb} ${cmd}`.trim()
    case 'interactive_shell':
      return `${verb} the interactive session`
    case 'write_stdin':
      return `${verb} the input to the session`
    case 'ApplyPatch':
      return `${verb} the patch`
    case 'Edit':
      return `${verb} the edit`
    default:
      return `${verb} ${tool}`
  }
}

type Header = { name?: string; summary?: string }

/**
 * Bash, Edit and ApplyPatch take their verb and target from the toolkit's presentation of the tool
 * they alias. What the toolkit does not do and TheoCode keeps: flatten a multi-line command to one
 * line (`⏎`), fall back to `file` / `files` when the target is missing, and append the +/- counts
 * of a patch. The adapter that turns a presentation into the `formatToolHeader` /
 * `formatToolResult` pair is still missing from `@theokit/tui` (theokit-tui#295), so this reads
 * `header` from the map directly.
 */
const PRESENTATION = toolPresentation(
  {},
  { aliases: { Bash: 'shell_exec', Edit: 'edit_file', ApplyPatch: 'apply_patch' } },
)

function presented(tool: string, input: Record<string, unknown>, active: boolean): string {
  const entry = PRESENTATION.get(tool)
  // An installed `@theokit/tui` older than 0.83.4 ignores `aliases`; an empty header would hide that.
  if (!entry) throw new Error(`@theokit/tui >= 0.83.4 is required: no presentation for ${tool}`)
  return entry.header(input, active)
}

const HEADERS_BY_TOOL: ReadonlyMap<
  string,
  (input: Record<string, unknown>, active: boolean) => Header
> = new Map([
  [
    'Bash',
    (input, active) => ({
      name: presented(
        'Bash',
        { ...input, command: typeof input.command === 'string' ? oneLine(input.command) : '' },
        active,
      ).trim(),
    }),
  ],
  [
    'Edit',
    (input, active) => ({
      name: presented(
        'Edit',
        { ...input, path: typeof input.path === 'string' ? input.path : 'file' },
        active,
      ).trim(),
    }),
  ],
  [
    'ApplyPatch',
    (input, active) => {
      const patch = typeof input.patch === 'string' ? input.patch : ''
      return {
        name: `${presented('ApplyPatch', { patch, path: 'files' }, active).trim()}${diffCounts(patch)}`,
      }
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
    'CurrentTime',
    (_input, active) => ({ name: active ? 'Checking the time' : 'Checked the time' }),
  ],
  ['update_plan', (_input, active) => ({ name: active ? 'Updating plan' : 'Updated plan' })],
  [
    'ViewImage',
    (input, active) => {
      const path = typeof input.path === 'string' ? input.path : 'image'
      return { name: `${active ? 'Viewing' : 'Viewed'} ${path}`.trim() }
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
      'Edit',
      (p) => {
        if (p.ok === false) return { output: `Edit: ${errorText(p)}` }
        if (typeof p.replacements !== 'number') return undefined
        return {
          output: `Applied ${String(p.replacements)} edit${p.replacements === 1 ? '' : 's'}.`,
        }
      },
    ],
    [
      'CurrentTime',
      (p) => {
        if (p.ok === false) return { output: `CurrentTime: ${errorText(p)}` }
        return typeof p.CurrentTime === 'string' ? { output: p.CurrentTime } : undefined
      },
    ],
    [
      'Read',
      (p) => {
        if (p.ok === false) return { output: `Read: ${errorText(p)}` }
        return typeof p.content === 'string' ? { output: p.content } : undefined
      },
    ],
    [
      'ApplyPatch',
      (p) => {
        if (p.ok === false) return { output: `ApplyPatch: ${errorText(p)}` }
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
      'Grep',
      (p) => {
        if (p.ok === false) return { output: `Grep: ${errorText(p)}` }
        if (!Array.isArray(p.matches)) return undefined
        const lines = (
          p.matches as Array<{ file?: unknown; line?: unknown; preview?: unknown }>
        ).map((m) => `${String(m.file ?? '')}:${String(m.line ?? '')}: ${String(m.preview ?? '')}`)
        return { output: lines.length > 0 ? lines.join('\n') : '(no matches)' }
      },
    ],
    ['update_plan', planBody],
    ['Bash', shellBody],
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
  if (p.ok === false) return { output: `Bash: ${errorText(p)}` }
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
      'Bash',
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
      'Edit',
      (input) => ({
        toolType: 'Apply edit',
        command: typeof input.path === 'string' ? input.path : 'file',
      }),
    ],
    [
      'ApplyPatch',
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
