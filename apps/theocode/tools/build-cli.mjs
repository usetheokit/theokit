#!/usr/bin/env node
// M61 — build the distributable `exec` bundle: a single self-contained ESM file that runs
// goal/review/run/sessions WITHOUT tsx or the dev toolchain. Mirrors the repo's `acp:bundle` precedent
// (esbuild ESM). ESM is mandatory — a CJS bundle breaks `import.meta.url` (SDK persistence → "path
// undefined"). The one native runtime dep, node-pty, is EXTERNAL (loaded via createRequire, esbuild does
// not follow it) and only touched by run/resume's interactive_shell — goal/review never need it.
import { chmodSync, copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * DATA assets esbuild does not bundle, copied beside the output.
 *
 * `provider-catalog.json` is read by the SDK via `import.meta.url` — next to the RUNNING file, so
 * `dist/`. Without it, auto-compaction (context-window management) is silently disabled in every
 * model mode: nothing errors, long sessions just start losing context. Resolved from the SDK's real
 * dist via createRequire so the path holds regardless of hoisting.
 */
export const DATA_ASSETS = ['provider-catalog.json']

/**
 * The esbuild configuration, as a value.
 *
 * Separated from the build 2026-09-10. Everything here used to run at module top level, so the
 * file could not be imported without building — which is why the script that produces the artifact
 * `package.json:bin` points at shipped with no test. Every option below is a decision this
 * repository has already paid for once, and each of those failures was SILENT: the bundle built,
 * exited 0, and misbehaved at runtime. A config that can be read is a config that can be asserted.
 */
export function bundleOptions(root = REPO_ROOT) {
  return {
    entryPoints: [join(root, 'packages', 'cli', 'src', 'main.ts')],
    outfile: join(root, 'dist', 'theocode.mjs'),
    bundle: true,
    platform: 'node',
    // ESM is mandatory — a CJS bundle breaks `import.meta.url`, and the SDK resolves its
    // persistence paths from it (symptom: "path undefined", not a build error).
    format: 'esm',
    target: 'node22',
    // Native / optional deps stay external: node-pty (loaded via createRequire, not bundlable),
    // better-sqlite3 (optional; the SDK falls back to the built-in node:sqlite), and any raw
    // `.node` addon.
    // `proper-lockfile` is here for a DIFFERENT reason than the native ones, and that reason is
    // worth writing down: it is CJS and calls `require('path')` at load time. Inlined into an ESM
    // bundle, that `require` becomes esbuild's shim, which throws `Dynamic require of "path" is not
    // supported` — and the SDK, which loads the package with `await import()` inside a try, falls
    // into the failure branch and CARRIES ON WITHOUT a cross-process lock. Measured 2026-08-05: the
    // bundle warned `could not be loaded` while the same turn under `tsx` warned nothing at all. We
    // run the TUI, exec and ACP over the same sessions directory, so a lock that is silently off is
    // a race, not a detail.
    external: ['node-pty', 'better-sqlite3', 'proper-lockfile', '*.node'],
    // A shebang makes the artifact directly executable (`./dist/theocode.mjs`); chmod below sets
    // the exec bit.
    banner: { js: '#!/usr/bin/env node' },
    logLevel: 'warning',
  }
}

export async function buildCli(root = REPO_ROOT) {
  const options = bundleOptions(root)
  await build(options)
  chmodSync(options.outfile, 0o755)

  const distDir = dirname(options.outfile)
  const sdkRoot = dirname(createRequire(import.meta.url).resolve('@theokit/sdk/package.json'))
  for (const asset of DATA_ASSETS) {
    copyFileSync(join(sdkRoot, 'dist', asset), join(distDir, asset))
  }
  return options.outfile
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outfile = await buildCli()
  process.stdout.write(`built ${outfile} (+ ${DATA_ASSETS.join(', ')})\n`)
}
