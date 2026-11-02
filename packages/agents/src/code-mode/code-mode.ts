/**
 * B-386 — moved here from `theokit` (`packages/theo/src/server/agent/code-mode.ts`, which now
 * re-exports it), so an app that depends on `@theokit/agents` and not on the web package reaches it.
 * Typed over the SDK's own `CustomTool`, so any SDK tool, a published factory's included, is accepted.
 *
 * M29 — `createCodeMode`: expose a set of tools to agent-authored code run inside an
 * ISOLATION boundary, so the agent composes tools programmatically instead of one call at a time.
 *
 * Security posture (the whole point of this feature):
 *  - The isolation boundary (`sandbox`) is **injected**, never hand-rolled here (Top-risk 1). The app
 *    supplies a vetted sandbox — isolated-vm, QuickJS-WASM, or a locked-down worker. This module
 *    imports no VM (same posture as the injected deploy adapter / the M17 transport); the QuickJS-WASM
 *    one is `@theokit/agents/code-mode-quickjs`, whose VM packages are optional peers. `node:vm` is
 *    NOT a security boundary and MUST NOT be used as the sandbox.
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
import type { CustomTool } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * What a run hands along with each call: the run's `AbortSignal`, so a cancelled turn stops the
 * script and the host tool calls it started instead of leaving them running unobserved.
 */
export interface CodeModeCallOptions {
  readonly signal?: AbortSignal
}

/** The restricted API handed to sandboxed code: declared tool names → permission-gated callables. */
export type CodeModeApi = Record<
  string,
  (args: unknown, options?: CodeModeCallOptions) => Promise<unknown>
>

/** The injected isolation boundary. The app supplies a vetted implementation. */
export interface Sandbox {
  /**
   * Run `code` with access to ONLY `api` (the restricted tool surface). Resolve the code's result.
   * An implementation that honours `options.signal` ends the run when it aborts and passes a signal
   * to each `api` call; one that ignores it runs to its own bound.
   */
  run(code: string, api: CodeModeApi, options?: CodeModeCallOptions): Promise<unknown>
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

/**
 * The code-mode tool: an SDK `CustomTool` whose handler always answers a string (the script's JSON
 * result). Narrower than `CustomTool` on purpose, so `theokit`'s pass-through keeps the `string`
 * result its callers read.
 */
export type CodeModeTool = Omit<CustomTool, 'handler'> & {
  handler: (input: Record<string, unknown>, ctx?: CodeModeCallOptions) => Promise<string>
}

/**
 * Thrown when the permission gate denies a tool call from sandboxed code. A `TheokitAgentError`, so
 * `isTransientError` reads it: a denial is refused the same way on every attempt.
 */
export class CodeModePermissionDeniedError extends TheokitAgentError {
  override readonly name = 'CodeModePermissionDeniedError'

  constructor(tool: string, reason?: string) {
    const suffix = reason ? `: ${reason}` : ''
    super(`code-mode: tool '${tool}' denied by permission gate${suffix}`, {
      code: 'CODE_MODE_PERMISSION_DENIED',
      isRetryable: false,
    })
  }
}

/**
 * Thrown when a script calls a tool with arguments whose top-level shape the tool's `inputSchema`
 * refuses (B-697 D4), before the permission gate or the tool sees them. `property` is the argument
 * at fault, `undefined` when the arguments are not an object at all.
 */
export class CodeModeInvalidArgumentsError extends TheokitAgentError {
  override readonly name = 'CodeModeInvalidArgumentsError'

  constructor(
    readonly tool: string,
    readonly property: string | undefined,
    reason: string,
  ) {
    const at = property === undefined ? '' : ` ${property}`
    super(`code-mode: tool '${tool}' refused its arguments:${at} ${reason}`, {
      code: 'CODE_MODE_INVALID_ARGUMENTS',
      isRetryable: false,
    })
  }
}

/** The JSON Schema primitive types the argument check reads; any other `type` is the tool's job. */
const PRIMITIVE_CHECKS: Readonly<Partial<Record<string, (value: unknown) => boolean>>> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
}

/** The declared `type` of one property, when the schema gives it as a single string. */
function declaredTypeOf(inputSchema: Record<string, unknown>, key: string): string | undefined {
  const properties = inputSchema.properties as
    | Partial<Record<string, { type?: unknown }>>
    | undefined
  const type = properties?.[key]?.type
  return typeof type === 'string' ? type : undefined
}

/**
 * B-697 D4 — the top-level shape of a script's arguments against the tool's `inputSchema`: an
 * object, every `required` name present, every property of a declared primitive type of that type.
 * Nested objects, `enum`, `pattern` and the rest stay the tool's own validation.
 */
function checkArguments(tool: CustomTool, args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new CodeModeInvalidArgumentsError(tool.name, undefined, 'expected an object')
  }
  const input = args as Record<string, unknown>
  const required: unknown = tool.inputSchema.required
  for (const name of Array.isArray(required) ? required : []) {
    if (typeof name === 'string' && !Object.hasOwn(input, name)) {
      throw new CodeModeInvalidArgumentsError(tool.name, name, 'is required')
    }
  }
  for (const [key, value] of Object.entries(input)) {
    const type = declaredTypeOf(tool.inputSchema, key)
    const matches =
      type !== undefined && Object.hasOwn(PRIMITIVE_CHECKS, type)
        ? PRIMITIVE_CHECKS[type]
        : undefined
    if (matches !== undefined && !matches(value)) {
      throw new CodeModeInvalidArgumentsError(tool.name, key, `expected ${type}`)
    }
  }
  return input
}

/**
 * A result as the JSON text the tool answers. `JSON.stringify` has no text for `undefined`, a
 * function, a symbol or an object whose `toJSON` answers one of those: that result reads `null`.
 */
function jsonTextOf(result: unknown): string {
  const text: unknown = JSON.stringify(result)
  return typeof text === 'string' ? text : 'null'
}

/** M40 — render a tool's JSON-Schema input as a readable arg shape, e.g. `{ limit: number, region?: string }`. */
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
 * M40 — generate the model-facing instructions from the SAME `tools` allow-list
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
 * Build a code-mode tool + its generated model instructions (M40). Fails fast if
 * `onPermissionRequest` or `sandbox` is missing (security by default). `tool` takes `{ code }`,
 * assembles the permission-gated restricted API from `tools`, runs the code in the injected sandbox,
 * and returns the code's result. `instructions` (add it to the agent's system prompt) teaches the
 * model the sandboxed-code contract + the available `api.<name>(input)` calls.
 */
export function createCodeMode(config: CodeModeConfig): {
  tool: CodeModeTool
  instructions: string
} {
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
    api[tool.name] = async (args: unknown, options?: CodeModeCallOptions): Promise<unknown> => {
      const input = checkArguments(tool, args)
      const decision = await config.onPermissionRequest({ tool: tool.name, args })
      if (!decision.granted) throw new CodeModePermissionDeniedError(tool.name, decision.reason)
      return options?.signal === undefined
        ? tool.handler(input)
        : tool.handler(input, { signal: options.signal })
    }
  }

  const name = config.name ?? 'run_code'
  const tool: CodeModeTool = {
    name,
    description:
      config.description ??
      'Run code that composes the available tools. Only the declared tools are callable.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'The code to run in the sandbox.' } },
      required: ['code'],
    },
    handler: async (input: Record<string, unknown>, ctx?: CodeModeCallOptions): Promise<string> => {
      const code = typeof input.code === 'string' ? input.code : ''
      const result =
        ctx?.signal === undefined
          ? await config.sandbox.run(code, api)
          : await config.sandbox.run(code, api, { signal: ctx.signal })
      // A result JSON has no text for still resolves the string the tool promises (B-697, #84).
      if (typeof result === 'string') return result
      return jsonTextOf(result)
    },
  }
  return { tool, instructions: generateCodeModeInstructions(config.tools, name) }
}
