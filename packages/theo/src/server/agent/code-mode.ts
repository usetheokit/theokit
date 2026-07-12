/**
 * M29 (ADR-0041) — `createCodeMode`: expose a set of tools to agent-authored code run inside an
 * ISOLATION boundary, so the agent composes tools programmatically instead of one call at a time.
 *
 * Security posture (the whole point of this feature):
 *  - The isolation boundary (`sandbox`) is **injected**, never hand-rolled here (Top-risk 1). The app
 *    supplies a vetted sandbox — isolated-vm, QuickJS-WASM, or a locked-down worker. TheoKit core
 *    ships no VM and adds no sandbox dependency (same posture as the injected deploy adapter / the
 *    M17 transport). `node:vm` is NOT a security boundary and MUST NOT be used as the sandbox.
 *  - TheoKit owns the **restricted API** (only the declared tools are reachable from the code — no
 *    `fs`, `process`, `require`, or network unless a declared, permission-gated tool provides it) and
 *    the **mandatory permission gate**: every tool call from the code passes `onPermissionRequest`
 *    first, and there is NO default-allow (mirrors M17 `onPermissionRequest`).
 *
 * Threat model (summary): a malicious model could author code that (a) calls a dangerous tool, or
 * (b) tries to reach a host capability. (a) is stopped by the permission gate (deny → the API call
 * throws). (b) is stopped by the injected sandbox (the restricted API is the ONLY surface the code
 * sees). If the app injects a weak sandbox, (b) is on the app — hence the vetted-sandbox requirement.
 */
import type { CustomTool } from '../define/define-agent-tool.js'

/** The restricted API handed to sandboxed code: declared tool names → permission-gated callables. */
export type CodeModeApi = Record<string, (args: unknown) => Promise<unknown>>

/** The injected isolation boundary. The app supplies a vetted implementation. */
export interface Sandbox {
  /** Run `code` with access to ONLY `api` (the restricted tool surface). Resolve the code's result. */
  run(code: string, api: CodeModeApi): Promise<unknown>
}

/** A permission decision for one tool call from sandboxed code. */
export interface CodeModePermission {
  granted: boolean
  /** Optional reason surfaced to the model on denial. */
  reason?: string
}

export interface CodeModeConfig {
  /** The tools reachable from the code (the restricted API). */
  tools: CustomTool[]
  /** The injected isolation boundary (vetted sandbox — NEVER node:vm). */
  sandbox: Sandbox
  /**
   * REQUIRED — decide each tool call the code attempts. Security by default: NO default-allow.
   * Return `{ granted }` (may be async). Mirrors M17 `onPermissionRequest`.
   */
  onPermissionRequest: (req: {
    tool: string
    args: unknown
  }) => CodeModePermission | Promise<CodeModePermission>
  /** Tool name the model calls (default `run_code`). */
  name?: string
  /** Tool description surfaced to the model. */
  description?: string
}

/** Thrown when the permission gate denies a tool call from sandboxed code. */
export class CodeModePermissionDeniedError extends Error {
  constructor(tool: string, reason?: string) {
    const suffix = reason ? `: ${reason}` : ''
    super(`code-mode: tool '${tool}' denied by permission gate${suffix}`)
    this.name = 'CodeModePermissionDeniedError'
  }
}

/** M40 (ADR-0049) — render a tool's JSON-Schema input as a readable arg shape, e.g. `{ limit: number, region?: string }`. */
function describeToolInput(inputSchema: Record<string, unknown>): string {
  const props = (inputSchema.properties as Record<string, { type?: unknown }> | undefined) ?? {}
  const required = new Set((inputSchema.required as string[] | undefined) ?? [])
  const entries = Object.entries(props).map(([key, spec]) => {
    // Complex Zod types (union/intersection/enum) may emit no top-level `type` → 'unknown' (safe).
    const type = typeof spec.type === 'string' ? spec.type : 'unknown'
    return `${key}${required.has(key) ? '' : '?'}: ${type}`
  })
  return entries.length > 0 ? `{ ${entries.join(', ')} }` : '{}'
}

/**
 * M40 (ADR-0049) — generate the model-facing instructions from the SAME `tools` allow-list
 * `createCodeMode` captures (DRY — cannot drift from the api surface it describes). Teaches the model
 * that its code runs in a sandbox, the available `api.<name>(input)` calls (ONLY this allow-list —
 * least-privilege scoping), and the return contract. Add it to the agent's system prompt.
 */
function generateCodeModeInstructions(tools: CustomTool[], toolName: string): string {
  const calls = tools
    .map((t) => `- \`await api.${t.name}(${describeToolInput(t.inputSchema)})\` — ${t.description}`)
    .join('\n')
  return [
    `The \`${toolName}\` tool runs your code in a sandbox. Your code may call ONLY these functions (each bridges to a real, validated tool on the host):`,
    calls,
    'Write an async function body that composes these calls and return exactly ONE structured result. Prefer `Promise.all` for independent calls; do arithmetic and aggregation in code, not in prose.',
  ].join('\n\n')
}

/**
 * Build a code-mode tool + its generated model instructions (M40 / ADR-0049). Fails fast if
 * `onPermissionRequest` or `sandbox` is missing (security by default). `tool` takes `{ code }`,
 * assembles the permission-gated restricted API from `tools`, runs the code in the injected sandbox,
 * and returns the code's result. `instructions` (add it to the agent's system prompt) teaches the
 * model the sandboxed-code contract + the available `api.<name>(input)` calls.
 */
export function createCodeMode(config: CodeModeConfig): { tool: CustomTool; instructions: string } {
  if (typeof config.onPermissionRequest !== 'function') {
    throw new Error(
      'createCodeMode requires onPermissionRequest (security by default — no default-allow for any tool).',
    )
  }
  const sandboxRun = (config.sandbox as { run?: unknown } | null | undefined)?.run
  if (typeof sandboxRun !== 'function') {
    throw new Error(
      'createCodeMode requires an injected `sandbox` with a run() method (a vetted isolation boundary — never node:vm).',
    )
  }
  // M40 — an empty allow-list is a config mistake: the restricted API (and the generated
  // instructions) would be empty, and the code could call nothing. Fail fast.
  if (config.tools.length === 0) {
    throw new Error(
      'createCodeMode requires a non-empty tools[] — the restricted API would be empty.',
    )
  }

  // Assemble the restricted API: each declared tool becomes a permission-gated callable.
  const api: CodeModeApi = {}
  for (const tool of config.tools) {
    api[tool.name] = async (args: unknown): Promise<unknown> => {
      const decision = await config.onPermissionRequest({ tool: tool.name, args })
      if (!decision.granted) throw new CodeModePermissionDeniedError(tool.name, decision.reason)
      return tool.handler(args as Record<string, unknown>)
    }
  }

  const name = config.name ?? 'run_code'
  const tool: CustomTool = {
    name,
    description:
      config.description ??
      'Run code that composes the available tools. Only the declared tools are callable.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'The code to run in the sandbox.' } },
      required: ['code'],
    },
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const code = typeof input.code === 'string' ? input.code : ''
      const result = await config.sandbox.run(code, api)
      return typeof result === 'string' ? result : JSON.stringify(result)
    },
  }
  return { tool, instructions: generateCodeModeInstructions(config.tools, name) }
}
