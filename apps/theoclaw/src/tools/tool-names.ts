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
  'show_widget',
  'web_search',
  'git_diff',
  'write_file',
  'edit_file',
  'apply_patch',
  'shell_exec',
  'interactive_shell',
  'write_stdin',
]

/**
 * The tools a `/control` agent holds beyond `buildTools`: `run_code` and `delegate_all` (B-386),
 * the `digest` workflow (B-387), the `triage` pair (B-679), the three schedule tools (B-396), and `delegate`, `question` and
 * the two task tools (B-611). An ACP agent under one of them would fail `Agent.create` on every
 * `/control` turn instead of at start. `tests/tool-registry.test.ts` checks it against what
 * `controlAgentToolOptions` adds.
 */
export const CONTROL_TOOL_NAMES: readonly string[] = [
  'run_code',
  'delegate_all',
  'digest',
  'triage',
  'triage_resume',
  'schedule_job',
  'list_scheduled_jobs',
  'cancel_scheduled_job',
  'delegate',
  'question',
  'task_declare',
  'task_complete',
]

/**
 * The MCP server names TheoClaw gives its own servers: `browser` with `THEOCLAW_BROWSER=on` (B-383).
 * An external server under one would replace TheoClaw's in the agent's one server map.
 */
export const BUILT_SERVER_NAMES: readonly string[] = ['browser']
