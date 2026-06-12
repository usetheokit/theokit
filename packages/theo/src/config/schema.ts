import { z } from 'zod'

import { servicesConfigSchema } from '../services/index.js'

import {
  cacheSchema,
  loggingSchema,
  rateLimitSchema,
  securitySchema,
  storageSchema,
  uploadSchema,
  type FormatErrorContext,
  type FormatErrorHook,
} from './schemas/index.js'

// Re-export per-concern schemas + types so downstream consumers
// (`adapters/*`, vite-plugin, generators, tests) keep their existing
// imports valid. Per plan T2.3 — pure structural split; zero behavior
// change at the call site.
export {
  cacheSchema,
  corsSchema,
  disallowedConfigSchema,
  headerSafeString,
  loggingSchema,
  rateLimitSchema,
  securityHeadersSchema,
  securitySchema,
  storageSchema,
  uploadSchema,
} from './schemas/index.js'

export type { FormatErrorContext, FormatErrorHook, StorageConfig } from './schemas/index.js'

/**
 * Root `theo.config.ts` schema — composer assembled from the per-concern
 * primitives re-exported above.
 *
 * Embedded blocks that exist ONLY as part of the root config (`agents`,
 * `ui`, `devtools`, `jobs`, `openapi`) stay inline below. They have no
 * external consumers; splitting them would create lonely files (M5
 * smell) without comprehension benefit.
 */
export const theoConfigSchema = z
  .object({
    /**
     * Plan v1.2 T2.1 — project identifier propagated into
     * `.theokit/services.json` v2 `project` field. DNS-1123 compatible (drives
     * Gitea repo + ArgoCD App naming on TheoCloud). When omitted, the build
     * emits services.json v1 with the legacy `services-bundle` fallback
     * (ADR D10) and logs a deprecation warning.
     */
    name: z
      .string()
      .max(63)
      .refine(
        // DNS-1123 equivalent expressed as explicit single-char anchors so
        // security/detect-unsafe-regex stays clean (no backtracking).
        (value) =>
          value.length > 0 &&
          /^[a-z0-9-]+$/u.test(value) &&
          !value.startsWith('-') &&
          !value.endsWith('-'),
        'name must match DNS-1123 (lowercase alphanumeric+hyphens, 1-63 chars, no leading/trailing hyphen)',
      )
      .optional(),
    appDir: z.string().default('app'),
    serverDir: z.string().default('server'),
    /**
     * T2.2 / EC-4 — Build output directory. Must be a relative path inside
     * the project root. Refused absolute or parent-relative paths to prevent
     * `cleanOutDir` from wiping arbitrary locations (defense-in-depth on
     * top of cleanOutDir's runtime EC-3 guard).
     */
    distDir: z
      .string()
      .default('.theokit')
      .refine(
        (d) => !/^([A-Za-z]:)?[/\\]/.test(d) && !d.startsWith('..'),
        'distDir must be a relative path inside the project root (e.g., ".theokit")',
      ),
    /**
     * Agent runtime configuration.
     *
     * - `maxRegistries` (T2.3, legacy): dev-mode cleanup of stale
     *   `.theokit/agents/<id>/` dirs by mtime. Now superseded by SDK's
     *   native registry GC but kept for backward-compat.
     * - `registry` (Phase 6, Production-Readiness #2): forwarded to
     *   `Agent.registry.configure()` lazily on first request.
     *   * `maxAgents` — LRU cap. MUST be ≥ max-concurrent-active-conversations
     *     (EC-17 DOCUMENT): with maxAgents:1 and 2 concurrent chats, LRU evicts
     *     mid-stream → SDK aborts with code:'aborted'. Default 100 covers
     *     indie/small-team; tune up for high-traffic.
     *   * `idleTimeoutMs` — auto-evict idle agents (default 30 min). 0 disables
     *     idle eviction (LRU only).
     */
    agents: z
      .object({
        maxRegistries: z.number().int().positive().default(100),
        registry: z
          .object({
            /** LRU cap — MUST be ≥ max-concurrent-active-conversations. */
            maxAgents: z.number().int().positive().max(10_000).default(100),
            /** Idle eviction window in ms. 0 disables idle eviction (LRU only). */
            idleTimeoutMs: z
              .number()
              .int()
              .nonnegative()
              .default(30 * 60_000),
          })
          .optional(),
      })
      .optional(),
    port: z.number().int().min(1).max(65535).default(3000),
    /** Listen on all addresses (0.0.0.0) for LAN/mobile testing. */
    host: z.union([z.string(), z.boolean()]).default('localhost'),
    /** Automatically open browser on `theokit dev`. */
    open: z.union([z.boolean(), z.string()]).default(false),
    /** Exit if port is already in use instead of trying next available. */
    strictPort: z.boolean().default(false),
    /** Forward browser console/errors to terminal — useful for AI agent dev. */
    forwardConsole: z
      .union([
        z.boolean(),
        z.object({
          unhandledErrors: z.boolean().optional(),
          logLevels: z.array(z.enum(['error', 'warn', 'info', 'log', 'debug'])).optional(),
        }),
      ])
      .default(false),
    ssr: z.boolean().default(false),
    /** When true (and ssr === true), use renderToPipeableStream with progressive
     * shell flush instead of single-shot renderToString. Opt-in for streaming
     * SSR; default false preserves the current behavior. */
    ssrStreaming: z.boolean().default(false),
    rateLimit: rateLimitSchema.optional(),
    upload: uploadSchema.optional(),
    logging: loggingSchema.optional(),
    security: securitySchema.optional(),
    serialization: z.enum(['json', 'superjson']).default('json'),
    // Plugins are validated structurally at runtime by createPluginRunnerFromConfig.
    // Zod only checks the shape minimally (must be array). Type-level safety is
    // provided through defineConfig at the user surface.
    plugins: z.array(z.unknown()).optional(),
    /** Enable client-side batching of theoFetch calls and the
     * /api/__theo_batch__ server endpoint. */
    batching: z
      .union([z.boolean(), z.object({ max: z.number().int().positive().optional() })])
      .optional(),
    /** T4.1 — Audit log. When `logger` is provided, framework events
     * (csrf.warn, rate-limit.exceeded, session.rotated, csp.violation) are
     * emitted to it. Default: noop. */
    audit: z
      .object({
        logger: z.unknown().optional(),
      })
      .optional(),
    /** TheoUI auto-wire (T2.1). `false` = opt-out; object = explicit theme/fonts;
     * undefined = enabled when @theokit/ui is detected in node_modules. */
    ui: z
      .union([
        z.literal(false),
        z.object({
          theme: z.enum(['violet-forge', 'noir', 'paper']).optional(),
          fonts: z.enum(['bundled', 'cdn']).optional(),
        }),
      ])
      .optional(),
    /**
     * Cache subsystem (caching-and-revalidation-plan).
     * Default `undefined` keeps caching disabled (backward compatible).
     * Pass `cache: {}` to opt in with defaults.
     */
    cache: cacheSchema.optional(),
    /**
     * Devtools overlay (Phase 0.4.0+ — see docs/plans/devtools-plan.md).
     *
     * - `undefined` (default): devtools auto-injects in `pnpm dev`, NEVER in `vite build`.
     * - `false`: devtools disabled entirely (Vite plugin skips injection even in dev).
     * - `{ ... }`: devtools enabled with explicit defaults (position, theme).
     *
     * Tree-shaken to noop in prod via the dual-export pattern in
     * `packages/theo/src/devtools/index.ts` (EC-17 positive prod check).
     */
    devtools: z
      .union([
        z.literal(false),
        z.object({
          position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
          theme: z.enum(['light', 'dark', 'system']).optional(),
        }),
      ])
      .optional(),
    /**
     * Informative list of deploy adapters the app supports. Does NOT
     * trigger per-build translations — only the `--target` CLI flag does
     * (EC-201 / ADR D2). If `config.adapters` includes a target NOT
     * matching `--target`, `theokit build` emits a cross-reference note.
     */
    adapters: z.array(z.string()).optional(),
    /**
     * Extra package names to pre-bundle via Vite's `optimizeDeps.include`.
     *
     * Framework auto-includes `@theokit/ui` and `lucide-react` when present.
     * Apps adding plugin peer-deps that rely on a runtime `import('<pkg>')`
     * (dynamic specifier) — e.g. `@theokit/plugin-canvas` consumers
     * installing `mermaid` for Mermaid SVG rendering — must declare those
     * here so Vite can resolve the literal in dev mode without
     * "Failed to resolve module specifier" errors. Production builds use
     * tsup/esbuild bundling and are not affected.
     *
     * Example:
     *   viteOptimizeDeps: ['mermaid']
     */
    viteOptimizeDeps: z.array(z.string()).optional(),
    /**
     * Jobs backend (ADR D3 + T2.1). When configured, every request gets
     * `ctx.queue.enqueue` auto-wired via the outbox lifecycle. Pass a
     * `JobBackend` instance (InMemoryJobBackend, PostgresJobBackend, etc.).
     */
    jobs: z
      .object({
        backend: z.custom<unknown>((v) => typeof v === 'object' && v !== null),
      })
      .optional(),
    /**
     * StorageManager configuration (T1.1 / ADR-0007).
     *
     * Declares Postgres servers + databases + Redis servers. Consumed by
     * `getStorageManager().configure()` at boot via `start.ts`.
     *
     * Default `undefined` means manager exists but is not configured — adapters
     * relying on the manager (PostgresJobBackend.fromStorageManager, etc.) will
     * throw with an actionable error on first use.
     */
    storage: storageSchema.optional(),
    /**
     * Wave 2 — Polyglot services orchestration (T1.1 / ADR-0012/0013/0014/0015).
     *
     * Declarative external sidecar processes (Python FastAPI / Node Hono)
     * that boot alongside the TheoKit TS app. Empty `services: {}` is the
     * default and preserves Wave 1 behavior.
     */
    services: servicesConfigSchema,
    /**
     * G2 — OpenAPI emit (build-time only).
     *
     * When present, `theokit build` writes a generated `openapi.json` from
     * every `defineRoute()` body/query/params Zod schema. `undefined` keeps
     * the framework backward-compatible (no emit). Pass `openapi: {}` to
     * opt in with defaults.
     *
     * Defaults: spec 3.1.0 · servers `http://localhost:3000` · title
     * "TheoKit App" · version "0.0.0" · outDir ".theokit" (next to dist).
     *
     * The env var `THEOKIT_OPENAPI_SERVERS` (CSV of URLs) overrides
     * `servers[].url` at emit time without rebuilding the config.
     */
    openapi: z
      .object({
        servers: z
          .array(
            z.object({
              url: z.url(),
              description: z.string().optional(),
            }),
          )
          .default([{ url: 'http://localhost:3000', description: 'Local development' }]),
        specVersion: z.enum(['3.1.0', '3.0.3']).default('3.1.0'),
        title: z.string().default('TheoKit App'),
        version: z.string().default('0.0.0'),
        outDir: z.string().default('.theokit'),
      })
      .optional(),
    /**
     * G5 T1.3 — error envelope transformer hook (blueprint ADR D3).
     *
     * When present, runs at framework error-boundary time to enrich the
     * envelope with consumer-defined extensions (`hint`, custom telemetry
     * tags, etc.) BEFORE the envelope is serialized to the client. The
     * function signature is preserved via the explicit `FormatErrorHook`
     * type — TS inference flows from `theo.config.ts` into `@theo/client`
     * codegen and `@theokit/ui` AgentErrorCard consumers.
     *
     * Use `z.custom<FormatErrorHook>(...)` because Zod's built-in
     * `z.function()` discards its TS signature after parse; `z.custom`
     * with a function-typed runtime guard preserves the call-site type
     * without trading off Zod runtime validation.
     */
    formatError: z
      .custom<FormatErrorHook>((val) => typeof val === 'function', {
        message: 'formatError must be a function',
      })
      .optional(),
  })
  // EC-2 fix: cross-config refine — no service may share TheoKit's web port.
  .refine((cfg) => !Object.values(cfg.services).some((s) => s.port === cfg.port), {
    message: 'service.port collides with TheoKit web port — change one of them',
    path: ['services'],
  })

export type TheoConfig = z.infer<typeof theoConfigSchema>

export type OpenApiConfig = NonNullable<TheoConfig['openapi']>

// Silence unused-import warnings for type-only re-exports — TS strips at compile,
// but exports above re-introduce them for downstream consumers.
export type _FormatErrorContext = FormatErrorContext
