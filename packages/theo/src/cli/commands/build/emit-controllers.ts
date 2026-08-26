import 'reflect-metadata'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CONTROLLER_PREFIX,
  ROUTE_METHODS,
  USE_GUARDS,
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
function assertControllerPathsReachable(
  loaded: readonly { cls: ControllerClass; sourceFile: string }[],
): void {
  for (const { cls, sourceFile } of loaded) {
    const meta = getMeta<{ prefix?: string }>(CONTROLLER_PREFIX, cls)
    const prefix = meta?.prefix ?? ''
    if (isReachable(prefix)) continue
    throw new UnreachableControllerPathError(cls.name || 'a controller', prefix, sourceFile)
  }
}

/**
 * The metadata key an explicitly-open controller route sets.
 *
 * The counterpart of `'public'` on the file path, and it exists for the same routes: a health
 * check a load balancer calls with no session, an OAuth callback the provider redirects to. Written
 * as `@SetMetadata(PUBLIC_ROUTE_METADATA, true)` — `@theokit/http` already ships `SetMetadata`, so
 * this needs no new decorator (parsimony-ladder.md rung 4).
 *
 * It is an opt-out, never a default. A route that is open says so in the file, where review sees
 * it; a route nobody thought about is the one that ships open, which is the whole reason ADR 0001
 * made absence stop meaning open on the file path.
 */
export const PUBLIC_ROUTE_METADATA = 'theokit:public'

/**
 * A controller route that declares no access decision at all.
 *
 * Distinct from a guard REFUSING a request — that is the system working. This is a route where
 * nobody wrote down whether it should be reachable, which on the file path is a build failure and
 * on the decorator path was, until now, silence.
 *
 * Measured against theokit@0.56.0: a `@Controller` with no guard answered 200 to a request with no
 * session, while the file route it would replace answered 403, on the same server in the same
 * second. The mechanism was never missing — `@UseGuards` works and returns `403 FORBIDDEN`. Only
 * the refusal of absence was.
 */
export class UndeclaredControllerAccessError extends Error {
  override readonly name = 'UndeclaredControllerAccessError'
  constructor(
    readonly controller: string,
    readonly method: string,
    readonly verb: string,
    readonly file: string,
  ) {
    super(
      [
        `${controller}.${method}() serves ${verb} and declares no access decision.`,
        ``,
        `  ${file}`,
        ``,
        `  A file route with no \`.policy\` fails this build for the same reason (ADR 0001): a route`,
        `  nobody thought about is the one that ships open. The decorator path now says the same.`,
        ``,
        `  Require a session:`,
        ``,
        `      @UseGuards(AuthGuard)   // on the method, or on the @Controller to cover all of them`,
        ``,
        `  Or state that it is open on purpose — a health check, an OAuth callback:`,
        ``,
        `      @SetMetadata('${PUBLIC_ROUTE_METADATA}', true)`,
        ``,
        `  Both are declarations. What is refused is neither.`,
      ].join('\n'),
    )
  }
}

/**
 * Refuse any controller route whose access decision nobody wrote down.
 *
 * A guard on the CLASS covers every method under it, which is the shape most controllers want and
 * mirrors how `@UseGuards` already behaves at runtime — the gate must agree with the dispatcher or
 * it would refuse code that works.
 *
 * Read off the compiled module for the reason the prefix check is: decorator metadata is what the
 * runtime matches on. The per-method key lives on the CLASS with the property name, not on the
 * prototype and not on the descriptor — measured, after both of those returned `undefined`.
 */
function assertControllerAccessDeclared(
  loaded: readonly { cls: ControllerClass; sourceFile: string }[],
): void {
  for (const { cls, sourceFile } of loaded) {
    // Class level covers every method under it — for BOTH forms. A guard on the class already
    // behaves that way at runtime, and a controller whose routes are all open (a health group, an
    // OAuth callback group) must be declarable once for the same reason. Checking one at class
    // level and not the other would refuse code that is correct.
    if (getMeta<unknown[]>(USE_GUARDS, cls) !== undefined) continue
    if (Reflect.getMetadata(PUBLIC_ROUTE_METADATA, cls) === true) continue

    const routes = getMeta<{ verb: string; propertyKey: string }[]>(ROUTE_METHODS, cls) ?? []
    for (const { verb, propertyKey } of routes) {
      if (getMeta<unknown[]>(USE_GUARDS, cls, propertyKey) !== undefined) continue
      // `Reflect` directly, not `getMeta`: `@SetMetadata` writes through `Reflect.defineMetadata`
      // with the key as given, and `getMeta` is typed for the symbol keys this package defines.
      if (Reflect.getMetadata(PUBLIC_ROUTE_METADATA, cls, propertyKey) === true) continue
      throw new UndeclaredControllerAccessError(
        cls.name || 'a controller',
        propertyKey,
        verb,
        sourceFile,
      )
    }
  }
}

/**
 * Load every emitted controller class once, for both checks below.
 *
 * One pass rather than one per check: the alternative loads each module twice and doubles the
 * surface on which a stale import could fool a gate.
 *
 * The `?t=` is a cache-bust. `emitControllerArtifacts` runs once per build process today, so it
 * changes nothing now — it is here because these are SECURITY gates, and the failure mode if a
 * watch mode is ever added is one that reads metadata from a version of the file that no longer
 * exists and passes it. `parsimony-ladder.md` is explicit that security is not what the ladder
 * trims, and the cost is a query parameter.
 */
async function loadEmittedControllers(
  emitted: readonly { modulePath: string; sourceFile: string }[],
): Promise<{ cls: ControllerClass; sourceFile: string }[]> {
  const out: { cls: ControllerClass; sourceFile: string }[] = []
  for (const { modulePath, sourceFile } of emitted) {
    const url = `${pathToFileURL(modulePath).href}?t=${Date.now()}`
    const mod: Record<string, unknown> = await import(url)
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || !isControllerClass(exported)) continue
      out.push({ cls: exported as ControllerClass, sourceFile })
    }
  }
  return out
}

/** A class carrying `@Controller` metadata — narrowed once so both checks read the same shape. */
type ControllerClass = (new (...args: never[]) => unknown) & { name: string }

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
  const loaded = await loadEmittedControllers(emitted)
  assertControllerPathsReachable(loaded)
  assertControllerAccessDeclared(loaded)

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
