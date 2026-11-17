import type { BuiltinToolName } from '@theokit/sdk'

/** What kind of card a surface should pick for a tool. */
export type ToolKind =
  | 'shell'
  | 'diff'
  | 'read'
  | 'write'
  | 'list'
  | 'search'
  | 'fetch'
  | 'plan'
  | 'memory'
  | 'other'

export interface ToolKindEntry {
  readonly kind: ToolKind
  /** Input keys that name the call's target, in preference order (e.g. ['command', 'cmd'] or ['path', 'file_path']). */
  readonly targetKeys: readonly string[]
}

const SHELL_KEYS = ['command', 'cmd'] as const
const PATH_KEYS = ['path', 'file_path'] as const

// Fails to compile if the SDK adds a builtin this table does not name. Type-only import:
// nothing from the SDK is loaded at runtime.
const BUILTIN_KINDS: Record<BuiltinToolName, ToolKindEntry> = {
  shell: { kind: 'shell', targetKeys: SHELL_KEYS },
  memory_search: { kind: 'memory', targetKeys: ['query'] },
  memory_get: { kind: 'memory', targetKeys: ['path'] },
}

const TUI_KINDS: Readonly<Record<string, ToolKindEntry>> = {
  shell_exec: { kind: 'shell', targetKeys: SHELL_KEYS },
  interactive_shell: { kind: 'shell', targetKeys: SHELL_KEYS },
  write_stdin: { kind: 'shell', targetKeys: ['session_id', 'chars'] },
  run_vitest: { kind: 'shell', targetKeys: ['path', 'file', 'command'] },
  git_diff: { kind: 'diff', targetKeys: ['path'] },
  apply_patch: { kind: 'diff', targetKeys: ['path', 'file_path'] },
  edit_file: { kind: 'write', targetKeys: PATH_KEYS },
  write_file: { kind: 'write', targetKeys: PATH_KEYS },
  read_file: { kind: 'read', targetKeys: PATH_KEYS },
  list_dir: { kind: 'list', targetKeys: ['path', 'dir'] },
  glob_files: { kind: 'list', targetKeys: ['pattern', 'glob'] },
  git_status: { kind: 'list', targetKeys: ['path'] },
  search_text: { kind: 'search', targetKeys: ['query', 'pattern'] },
  web_search: { kind: 'search', targetKeys: ['query'] },
  web_fetch: { kind: 'fetch', targetKeys: ['url'] },
  plan_mode: { kind: 'plan', targetKeys: [] },
  update_plan: { kind: 'plan', targetKeys: [] },
  todolist: { kind: 'plan', targetKeys: [] },
  current_time: { kind: 'other', targetKeys: [] },
  question: { kind: 'other', targetKeys: ['question'] },
}

/** Known tool names, exact match only. Never a substring guess. */
export const TOOL_KINDS: ReadonlyMap<string, ToolKindEntry> = new Map<string, ToolKindEntry>([
  ...Object.entries(BUILTIN_KINDS),
  ...Object.entries(TUI_KINDS),
])

/** Exact lookup; `undefined` for an unknown name. */
export function toolKindOf(name: string): ToolKindEntry | undefined {
  return TOOL_KINDS.get(name)
}
