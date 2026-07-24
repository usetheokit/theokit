/**
 * `theokit openapi` — regenerate `<distDir>/openapi.json` standalone.
 *
 * Mirrors trpc-openapi's `pnpm codegen` script. Useful in dev workflows
 * when only schemas changed and a full `theokit build` would be
 * overkill.
 *
 * Per G2 plan v1.1 T2.3. Single output (dev location only) — for the
 * dist artifact, run `theokit build`.
 *
 * Flags:
 *   --dry-run   Validate + print the document to stdout; skip the
 *               filesystem write (EC-3 absorbed).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { loadConfig } from '../../config/load-config.js'
import { generateManifest } from '../../server/scan/manifest.js'
import { emitOpenApi } from '../../vite-plugin/openapi-emit/emit.js'
import { loadRoutesForOpenApi } from '../../vite-plugin/openapi-emit/load-routes.js'

const MIGRATION_GUIDE_URL = 'docs/concepts/openapi.md'

interface OpenApiCommandOptions {
  /** Project root (defaults to `process.cwd()`). */
  cwd?: string
  /** Skip the filesystem write; print the document to stdout (EC-3). */
  dryRun?: boolean
}

export async function openapiCommand(options: OpenApiCommandOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd)

  if (config.openapi === undefined) {
    console.error(
      `\n  ✗ openapi: not configured in theo.config.ts\n\n` +
        `  Add the \`openapi\` block to opt in:\n\n` +
        `    export default defineConfig({\n` +
        `      openapi: {\n` +
        `        title: 'My App',\n` +
        `        version: '1.0.0',\n` +
        `      },\n` +
        `    })\n\n` +
        `  See ${MIGRATION_GUIDE_URL} for the full reference.\n`,
    )
    process.exit(1)
    return
  }

  const serverDir = resolve(cwd, config.serverDir)
  const manifest = generateManifest(serverDir)
  const hydrated = await loadRoutesForOpenApi({ serverDir, routes: manifest.routes })

  if (options.dryRun) {
    // Build the document without writing — for the dry-run we still want a
    // valid emit pass, but with an in-memory output dir we never touch disk.
    const result = emitOpenApiInMemory(hydrated, config.openapi)
    console.log(`\n  ✓ openapi.json (dry-run): ${String(hydrated.length)} ops`)
    console.log(JSON.stringify(result.document, null, 2))
    console.log(`\n  Docs: ${MIGRATION_GUIDE_URL}\n`)
    return
  }

  const distDir = resolve(cwd, config.distDir)
  const result = emitOpenApi({
    manifest: hydrated,
    config: { ...config.openapi, outDir: distDir },
  })
  console.log(
    `\n  ✓ openapi.json: ${String(hydrated.length)} ops → ${result.path}\n` +
      `  Docs: ${MIGRATION_GUIDE_URL}\n`,
  )
}

/**
 * Dry-run helper: build the OpenAPI doc without writing. Routes through
 * the same `emitOpenApi` but discards the side-effecting write by
 * targeting a temp directory we immediately ignore.
 *
 * Honest tradeoff: this still calls `mkdirSync` (no-op on existing tmpdir)
 * + a synchronous write to a discardable tempfile. Cost is < 1ms and the
 * code stays the single transformation. A pure no-write helper would
 * duplicate the orchestration in `emit.ts` — KISS prefers reuse.
 */
function emitOpenApiInMemory(
  manifest: Parameters<typeof emitOpenApi>[0]['manifest'],
  config: Omit<Parameters<typeof emitOpenApi>[0]['config'], 'outDir'>,
): { document: unknown } {
  const tmp = mkdtempSync(join(tmpdir(), 'theokit-openapi-dryrun-'))
  try {
    const result = emitOpenApi({ manifest, config: { ...config, outDir: tmp } })
    return { document: result.document }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
