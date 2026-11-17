import { describe, expect, it } from 'vitest'
import { TOOL_KINDS, toolKindOf } from '../src/index.js'

const NAMES = [
  'shell_exec',
  'interactive_shell',
  'write_stdin',
  'run_vitest',
  'git_diff',
  'apply_patch',
  'edit_file',
  'write_file',
  'read_file',
  'list_dir',
  'glob_files',
  'git_status',
  'search_text',
  'web_search',
  'web_fetch',
  'plan_mode',
  'update_plan',
  'todolist',
  'current_time',
  'question',
  'shell',
  'memory_search',
  'memory_get',
]

describe('TOOL_KINDS', () => {
  it('every name in the TUI measured list and every SDK builtin has an entry', () => {
    for (const n of NAMES) expect(toolKindOf(n), n).toBeDefined()
    expect(TOOL_KINDS.size).toBe(23)
  })

  it('shell is a shell tool with target key command', () => {
    expect(toolKindOf('shell')).toEqual({ kind: 'shell', targetKeys: ['command', 'cmd'] })
  })

  it('lookup is exact: thread_summary and execute_sql are unknown', () => {
    expect(toolKindOf('thread_summary')).toBeUndefined()
    expect(toolKindOf('execute_sql')).toBeUndefined()
  })
})
