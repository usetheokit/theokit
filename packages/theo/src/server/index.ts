/**
 * theokit/server — DEPRECATED umbrella barrel.
 *
 * **Per plan theokit-arch-gaps-implementation T2.5 (M1) + EC-2:**
 *
 * Importing from `theokit/server` is DEPRECATED as of this release. The
 * 16 sub-domain exports (auth, jobs, http, security, observability, etc.)
 * are now individually addressable via `package.json#exports`:
 *
 *   import { defineAuth } from 'theokit/server/auth'
 *   import { defineJob }  from 'theokit/server/jobs'
 *   import { defineRoute, defineAction } from 'theokit/server/define'
 *   // ...etc per `packages/theo/package.json` exports field
 *
 * This umbrella barrel will continue to work for ONE minor cycle
 * (0.x → 0.x+1) with a single runtime warning printed on first import.
 * Final removal in 0.x+2 per CHANGELOG.
 *
 * Why: `export *` wildcards across 16 sub-domains violate ISP at the
 * package-surface level (consumers pay for 376 transitive exports when
 * they wanted 6). See `architecture-output/consolidated_final_report.md`
 * M1 finding + blueprint Q4 D4 (Hono-shape exports field adoption).
 *
 * Migration codemod (provided in this release):
 *   pnpm exec theokit migrate server-umbrella-to-subpaths
 *
 * For body-parser, serialization, transformer, webhook helpers, trace context
 * propagation, error pages, plugin types, and config/env helpers — re-exported
 * inline because they don't fit a single sub-barrel cleanly. Those will land
 * in a `theokit/server/runtime` sub-path in the 0.x+2 cleanup.
 */

// One-time deprecation warning. Fires on first import in the process and
// is silenced afterwards via a module-scoped flag. Tree-shake-safe: the
// IIFE body executes on module load (no DCE), but the cost is one
// console.warn at startup — negligible. Apps that grep for this string
// see exactly which entry point logged it.
if (typeof globalThis !== 'undefined') {
  const WARN_KEY = '__theokit_server_umbrella_warn_emitted__'
  const g = globalThis as Record<string, unknown>
  if (g[WARN_KEY] !== true) {
    g[WARN_KEY] = true

    console.warn(
      '[theokit] umbrella import "theokit/server" is DEPRECATED. ' +
        'Use sub-paths (theokit/server/<domain>): auth, jobs, http, security, ' +
        'observability, etc. See packages/theo/package.json#exports for the ' +
        'full list. Removal scheduled for 0.x+2.',
    )
  }
}

// Core defines + low-level pipeline primitives (used by adapter templates)
export * from './define/index.js'
export * from './http/index.js'
export * from './scan/index.js'

// G3 action protocol: ActionError + ActionInputError + helpers, re-exported
// from core/contracts for consumer ergonomics (`from 'theokit/server'`).
export {
  ActionError,
  ActionInputError,
  extractUniversalIssues,
  isActionError,
  isInputError,
  type ActionErrorCode,
  type ActionManifestEntry,
  type ActionResult,
  type SerializedActionResult,
  type UniversalZodIssue,
} from '../core/contracts/action-protocol.js'

// Subdomain sub-barrels (consumers can also import direct: theokit/server/<sub>)
// (server/agent had only the proprietary surface — removed in the M3 clean break;
// its survivors mount-agent/provider-resolver/configure-agent-registry are internal.)
export * from './auth/index.js'
export * from './cost/index.js'
export * from './cron/index.js'
export * from './jobs/index.js'
export * from './observability/index.js'
export * from './plugins/index.js'
export * from './rate-limit/index.js'
export * from './realtime/index.js'
export * from './security/index.js'
export * from './storage/index.js'
export * from './webhook/index.js'
export * from './openapi/index.js'

// Cross-module: cache lives at packages/theo/src/cache/ (not server/cache)
export * from '../cache/index.js'

// Agent-tool adapters — wrap an external runtime (coding agent, SDK workflow) as a `CustomTool`.
// M26 — SDK `Workflow` as a tool (thin adapter; the engine is the SDK's). M17 — coding agent (ACP).
export { createWorkflowTool } from './agent/workflow-tool.js'
export type { WorkflowLike, WorkflowToolConfig } from './agent/workflow-tool.js'
export { createACPTool, NodeAcpTransport } from './agent/acp-tool.js'
export type { AcpToolConfig } from './agent/acp-tool.js'
// M28 — third-party agent SDK (Claude/OpenAI/Cursor) as a tool (vendor runtime stays theirs).
export { createVendorAgentTool } from './agent/vendor-agent-tool.js'
export type { VendorAgentClient, VendorAgentToolConfig } from './agent/vendor-agent-tool.js'
// M29 — code-mode sandbox: agent composes tools in code run inside an INJECTED isolation boundary.
export { createCodeMode, CodeModePermissionDeniedError } from './agent/code-mode.js'
export type { Sandbox, CodeModeApi, CodeModeConfig, CodeModePermission } from './agent/code-mode.js'
// M27 — channel webhook routes (Slack/Telegram/Discord) with per-platform signature validation.
export { handleChannelWebhook, parseChannelPath, isChannelPath } from './agent/channel-webhook.js'
export type { ChannelMessage, ChannelWebhookConfig } from './agent/channel-webhook.js'
// M30 — MCP App `ui://` HTML resources served by the MCP server (rendered in a sandboxed iframe).
// MCP stdio transport — expose an agent as a stdio MCP server (sibling of the HTTP route).
export { serveMcpStdio, handleMcpStdioLine, type StdioStreams } from './agent/mcp-stdio.js'
export {
  defineAppResource,
  buildResourceDescriptors,
  readAppResource,
  extractAppResources,
} from './agent/mcp-app-resources.js'
export type {
  AppResource,
  AppResourceInput,
  McpResourceDescriptor,
  McpResourceContents,
} from './agent/mcp-app-resources.js'

// Inline re-exports — items that don't belong to a single sub-barrel
export { parseRequestBody, FileTooLargeError } from './body-parser.js'
export type { UploadedFile, ParsedBody, BodyParserOptions } from './body-parser.js'

export { serializeResponse, deserializeResponse } from './serialization.js'
export type { SerializedResponse } from './serialization.js'

export { superjsonTransformer, jsonTransformer, resolveTransformer } from './transformer.js'
export type { TheoTransformer } from './transformer.js'

// T5a.2 Phase A — Web-Standards entry-point (R3a per ADR-0028). Accepts
// a native Web Request and returns a native Web Response. Narrow scope:
// method dispatch + Zod validation + envelope-shaped errors. Plugin
// runner / CSRF / CORS / middleware integration deferred to Phase B-G
// per docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md.
export { executeWebRequest } from './web-handler.js'

// Plugin types (used by definePlugin + extension authors)
export type {
  TheoPlugin,
  TheoApp,
  PluginContext,
  PluginErrorContext,
  HookName,
  HookResult,
  OnRequestHook,
  PreHandlerHook,
  OnResponseHook,
  OnErrorHook,
  RunHookOptions,
} from './plugin-types.js'
export { definePlugin } from './plugin-types.js'

// Config helpers — auto-load .env for standalone server scripts (Telegram bots,
// queue consumers, cron jobs) that bypass the CLI.
export { loadEnv, _resetEnvCache } from '../config/load-env.js'
export type { LoadEnvOptions, LoadEnvResult } from '../config/load-env-types.js'

// Wave 2 — Polyglot services orchestration types (types only — runtime in services/)
export type {
  ServiceDefinition,
  ServicesConfig,
  ServicesConfigInput,
  ServicesConfigOutput,
} from '../services/index.js'
