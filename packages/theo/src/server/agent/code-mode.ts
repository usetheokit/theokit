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

/**
 * Build a code-mode `CustomTool`. Fails fast if `onPermissionRequest` or `sandbox` is missing
 * (security by default). The returned tool takes `{ code }`, assembles the permission-gated restricted
 * API from `tools`, runs the code in the injected sandbox, and returns the code's result.
 */
export function createCodeMode(config: CodeModeConfig): CustomTool {
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

  // Assemble the restricted API: each declared tool becomes a permission-gated callable.
  const api: CodeModeApi = {}
  for (const tool of config.tools) {
    api[tool.name] = async (args: unknown): Promise<unknown> => {
      const decision = await config.onPermissionRequest({ tool: tool.name, args })
      if (!decision.granted) throw new CodeModePermissionDeniedError(tool.name, decision.reason)
      return tool.handler(args as Record<string, unknown>)
    }
  }

  return {
    name: config.name ?? 'run_code',
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
}
