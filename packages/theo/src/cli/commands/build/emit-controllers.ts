import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { transformControllerSource } from '@theokit/http'

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
export interface ControllerBuildManifest {
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
  }

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
