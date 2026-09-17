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
 * Resolves Ink's optional devtools client to an empty module.
 *
 * `react-devtools-core` is a peer Ink declares `optional: true`, and it is not installed here.
 * Ink guards it correctly at runtime — `reconciler.js` probes with `import.meta.resolve` and only
 * then `await import('./devtools.js')`. What defeats that guard is bundling: esbuild follows the
 * dynamic import, pulls `devtools.js` in, and its STATIC `import devtools from
 * 'react-devtools-core'` is hoisted to the top of the bundle, where Node resolves it on load.
 *
 * Marking it external was tried first and is wrong for the same reason: esbuild says plainly that
 * it "leaves the unresolved path in the bundle", so the binary died on startup with
 * ERR_MODULE_NOT_FOUND. The comment justifying it claimed the import sat on a branch production
 * never takes — measured false by running it.
 *
 * An empty module is the honest substitute: the probe above it fails either way, so the code that
 * would touch these exports never runs, and nothing ships a devtools client in a released CLI.
 */
const devtoolsStub = {
  name: 'ink-devtools-stub',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'ink-devtools-stub',
    }))
    build.onLoad({ filter: /.*/, namespace: 'ink-devtools-stub' }, () => ({
      contents: 'export default {}\nexport const connectToDevTools = () => {}\n',
      loader: 'js',
    }))
  },
}

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
    // Ink's optional devtools client, resolved to an empty module — see `devtoolsStub` above
    // for why `external` does not work here.
    plugins: [devtoolsStub],
    // A shebang makes the artifact directly executable (`./dist/theocode.mjs`); chmod below sets
    // the exec bit.
    //
    // The `createRequire` line below it is what lets a bundled CJS dependency call `require` at load
    // time. esbuild rewrites such calls to its own `__require` shim, whose body reads
    // `typeof require !== "undefined" ? require.apply(...) : throw`, so defining `require` here is
    // the documented way to satisfy it — an ESM module has none otherwise.
    //
    // Measured, not anticipated: bundling the TUI pulled in `signal-exit@3.0.7` (a dependency of
    // Ink), which does `assert = require("assert")` in its module body. The binary built clean and
    // died on startup with `Dynamic require of "assert" is not supported`. This is the same failure
    // shape the `proper-lockfile` note above records, and the reason that one is external.
    banner: {
      js: [
        '#!/usr/bin/env node',
        "import { createRequire as __nodeCreateRequire } from 'node:module'",
        'const require = __nodeCreateRequire(import.meta.url)',
      ].join('\n'),
    },
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
