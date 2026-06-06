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
export * from './agent/index.js'
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

// Cross-module: cache lives at packages/theo/src/cache/ (not server/cache)
export * from '../cache/index.js'

// Inline re-exports — items that don't belong to a single sub-barrel
export { parseRequestBody, FileTooLargeError } from './body-parser.js'
export type { UploadedFile, ParsedBody, BodyParserOptions } from './body-parser.js'

export { serializeResponse, deserializeResponse } from './serialization.js'
export type { SerializedResponse } from './serialization.js'

export { superjsonTransformer, jsonTransformer, resolveTransformer } from './transformer.js'
export type { TheoTransformer } from './transformer.js'

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
