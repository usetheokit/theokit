/**
 * The name of every tool `buildTools` can register, so an external tool cannot take one of them.
 * `tests/tool-registry.test.ts` checks it equals every name `buildTools` returns with every tool on.
 */
export const BUILT_TOOL_NAMES: readonly string[] = [
  'read_file',
  'list_dir',
  'view_image',
  'web_fetch',
  'todolist',
  'web_search',
  'git_diff',
  'write_file',
  'edit_file',
  'apply_patch',
  'shell_exec',
]
