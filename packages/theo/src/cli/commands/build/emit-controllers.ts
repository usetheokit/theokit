import 'reflect-metadata'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CONTROLLER_PREFIX,
  getMeta,
  isControllerClass,
  transformControllerSource,
} from '@theokit/http'

import { findControllerFiles } from '../../../server/http/controller-dispatch.js'

/**
 * theokit#123 — compile `server/controllers/**` into `dist` so production can serve them.
 *
 * ## Why production needed anything at all
 *
 * #122 made decorator controllers first-class in `theokit dev`, where a Vite `enforce:'pre'` swc
 * transform compiles them on the fly — parameter decorators (`@Body`/`@Param`/`@Query`) emit
 * metadata esbuild cannot produce. `theokit start` has no Vite and no transform, so an uncompiled
 * `.controller.ts` simply cannot load, and controller routes 404'd in production while working in
 * dev. That split is the whole issue.
 *
 * ## Why compile at BUILD time rather than load with swc at runtime
 *
 * `loadControllerWithSwc` would work in production and was the smaller diff. It is refused on
 * purpose: `@swc/core` is a peer dependency and a native binary, so that path makes every deployed
 * app carry a compiler it only needs once, and turns a missing optional peer into a runtime 404
 * instead of a build failure. Compilation belongs where the rest of the build already is — and it
 * is what the issue's root-cause note asks for.
 *
 * ## Why NOT in `generateManifest`
 *
 * ADR-5 keeps controllers out of the manifest, and that is preserved here: the manifest is the
 * deploy-adapter contract, and adding a parallel route source to it would ripple through every
 * adapter. This emits a SEPARATE artifact (`dist/controllers.json` + `dist/controllers/*.mjs`) that
 * only the Node start path reads. An adapter that knows nothing about controllers keeps working
 * exactly as before.
 */

/** The build artifact `theokit start` reads to find compiled controllers. */
interface ControllerBuildManifest {
  version: 1
  /** Emitted module paths, relative to `distDir`, in scan order. */
  modules: string[]
}

export const CONTROLLER_MANIFEST_FILE = 'controllers.json'
const CONTROLLER_OUT_DIR = 'controllers'

/**
 * Compile every controller under `<serverDir>/controllers` into `<distDir>/controllers`.
 *
 * No controllers ⇒ **no artifact at all** (not an empty one). `theokit start` treats a missing
 * manifest as "this app has no controllers" and skips the whole branch, so a routes-only app pays
 * nothing and its `dist` is byte-identical to before — the ADR-5 posture, kept.
 */
/**
 * The URL prefix both runtimes gate the controller fall-through on.
 *
 * `start/handlers.ts` and `vite-plugin/api-middleware.ts` each return early unless the request URL
 * starts with `/api/`, so a controller declaring anything else describes a path that branch never
 * visits. Written here as a constant rather than a literal in the check, because the day that gate
 * moves this is the line that has to move with it.
 */
const SERVED_PREFIX = 'api'

/**
 * A controller compiled successfully and mounted at a path the runtime never routes to.
 *
 * Its own class so a caller can tell it from a compile failure: the source is fine, the decorators
 * are fine, and the app would start — the route simply answers 404 forever. That is the failure
 * this module's docblock already refuses for compile errors, reached by a different road.
 *
 * Measured against `theokit@0.56.0`: `@Controller('probe')` built clean, emitted a module, wrote
 * the manifest, and `/api/probe` returned 404. `/probe` returned **200** — the SPA fallback serving
 * `index.html`, so the status code agreed with success while the body was a web page. A defect that
 * survives a status-code check is exactly the kind a build gate has to catch instead.
 */
export class UnreachableControllerPathError extends Error {
  override readonly name = 'UnreachableControllerPathError'
  constructor(
    readonly controller: string,
    readonly declaredPath: string,
    readonly file: string,
  ) {
    super(
      [
        `${controller} declares \`@Controller('${declaredPath}')\`, which this runtime never routes to.`,
        ``,
        `  ${file}`,
        ``,
        `  Controller routes are served from a fall-through that runs only for URLs under`,
        `  \`/${SERVED_PREFIX}/\` — a file-route miss is what reaches it. A path outside that`,
        `  prefix compiles, emits, and then answers 404 for the life of the app.`,
        ``,
        `  Write it as:`,
        ``,
        `      @Controller('${SERVED_PREFIX}/${declaredPath.replace(/^\/+/, '')}')`,
        ``,
        `  Refused at build rather than left to 404, for the reason this module already refuses a`,
        `  compile error: shipping a route nothing can reach, with nothing pointing back at why.`,
      ].join('\n'),
    )
  }
}

/**
 * Is `prefix` reachable from the served path?
 *
 * `'api'`, `'/api'`, `'api/x'` and `'/api/x'` are the same URL written four ways, so all four pass:
 * the gate is about reachability, not spelling. A prefix that merely STARTS with the letters —
 * `'apiary'` — is not, which is why the check is segment-wise rather than a `startsWith`.
 */
function isReachable(prefix: string): boolean {
  const segments = prefix.split('/').filter((s) => s.length > 0)
  return segments[0] === SERVED_PREFIX
}

/**
 * Refuse any emitted controller whose declared path the runtime cannot route to.
 *
 * Reads the prefix off the COMPILED module rather than the source: the decorator metadata is what
 * the runtime will actually match on, and a regex over source text would disagree with it the first
 * time someone writes the prefix as anything other than a literal.
 */
async function assertControllerPathsReachable(
  emitted: readonly { modulePath: string; sourceFile: string }[],
): Promise<void> {
  for (const { modulePath, sourceFile } of emitted) {
    const mod: Record<string, unknown> = await import(pathToFileURL(modulePath).href)
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || !isControllerClass(exported)) continue
      // The metadata holds `{ prefix }`, not the bare string — measured off a compiled module
      // rather than assumed, because the first two guesses (a string, and `getMeta(target, key)`)
      // both type-checked and both threw.
      const meta = getMeta<{ prefix?: string }>(CONTROLLER_PREFIX, exported)
      const prefix = meta?.prefix ?? ''
      if (isReachable(prefix)) continue
      const name = exported.name || 'a controller'
      throw new UnreachableControllerPathError(name, prefix, sourceFile)
    }
  }
}

export async function emitControllerArtifacts(opts: {
  serverDir: string
  distDir: string
}): Promise<ControllerBuildManifest | null> {
  const controllersDir = resolve(opts.serverDir, CONTROLLER_OUT_DIR)
  const files = findControllerFiles(controllersDir)
  if (files.length === 0) return null

  const outDir = resolve(opts.distDir, CONTROLLER_OUT_DIR)
  mkdirSync(outDir, { recursive: true })

  const modules: string[] = []
  const emitted: { modulePath: string; sourceFile: string }[] = []
  for (const file of files) {
    // Errors are NOT caught. A controller that fails to compile must fail the BUILD — swallowing it
    // here would ship an app whose routes 404 at runtime with nothing pointing back at the cause,
    // which is the exact failure mode this issue reports (error-handling.md § 2).
    const code = await transformControllerSource(readFileSync(file, 'utf-8'), file)

    // Mirror the source tree under `dist/controllers` so two files with the same basename in
    // different folders cannot overwrite each other.
    const rel = relative(controllersDir, file).replace(/\.controller\.ts$/, '.controller.mjs')
    const outPath = join(outDir, rel)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, code)
    modules.push(`${CONTROLLER_OUT_DIR}/${rel.split('\\').join('/')}`)
    emitted.push({ modulePath: outPath, sourceFile: file })
  }

  // AFTER writing, because reading the prefix means loading the compiled module — and a module that
  // failed to compile has already thrown above. Before the manifest, so a refused build leaves no
  // artifact claiming a route that does not answer.
  await assertControllerPathsReachable(emitted)

  const manifest: ControllerBuildManifest = { version: 1, modules }
  writeFileSync(
    resolve(opts.distDir, CONTROLLER_MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + '\n',
  )
  return manifest
}

/** Human-facing summary for the build log (mirrors the cron/job emitters). */
export function describeControllerArtifacts(manifest: ControllerBuildManifest | null): string {
  if (manifest === null) return 'controllers: none'
  const names = manifest.modules.map((m) => basename(m, '.mjs')).join(', ')
  return `controllers: ${manifest.modules.length} compiled (${names})`
}
