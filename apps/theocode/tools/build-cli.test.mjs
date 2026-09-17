/**
 * Tests for the distributable-bundle build.
 *
 * This script produces `dist/theocode.mjs` — the artifact `package.json:bin` points at, i.e. what a
 * user actually runs — and it had no test (measured 2026-09-10). Every invariant asserted below is
 * one its own header records as already having cost this repository a real defect, and every one of
 * those defects was SILENT: the bundle built, exited 0, and misbehaved at runtime.
 *
 * That is the shape of the finding this file answers. A build script that mis-configures itself
 * still exits 0, the release is cut, and the green is read as evidence.
 *
 * The config is asserted rather than the built bundle. Running esbuild here would test esbuild;
 * what can regress is the DECISION — someone dropping an entry from `external`, or flipping the
 * format while chasing an unrelated warning.
 */
import { describe, expect, it } from 'vitest'

import { bundleOptions, DATA_ASSETS } from './build-cli.mjs'

const options = bundleOptions('/repo')

describe('bundleOptions', () => {
  it('test_the_bundle_is_esm', () => {
    // A CJS bundle breaks `import.meta.url`, and the SDK resolves its persistence paths from it —
    // the symptom was "path undefined", not a build error.
    expect(options.format).toBe('esm')
  })

  it('test_proper_lockfile_stays_external', () => {
    // Measured 2026-08-05 and the sharpest of these. `proper-lockfile` is CJS and calls
    // `require('path')` at load. Inlined into an ESM bundle that `require` becomes esbuild's shim
    // and throws; the SDK loads the package inside a try and CARRIES ON WITHOUT a cross-process
    // lock. The TUI, exec and ACP share one sessions directory, so a lock that is silently off is
    // a race. The bundle warned `could not be loaded`; the same turn under tsx warned nothing.
    expect(options.external).toContain('proper-lockfile')
  })

  it('test_native_deps_stay_external', () => {
    // node-pty is loaded via createRequire and esbuild cannot follow it; better-sqlite3 is
    // optional and the SDK falls back to node:sqlite; `.node` addons are not bundlable at all.
    for (const dep of ['node-pty', 'better-sqlite3', '*.node']) {
      expect(options.external, dep).toContain(dep)
    }
  })

  it('test_the_artifact_is_directly_executable', () => {
    // Without the shebang `./dist/theocode.mjs` is not runnable, and `bin` points straight at it.
    // Asserted as the FIRST LINE rather than as the whole banner: the banner carries a second
    // thing now (below), and an equality here would fail for a change that breaks nothing while
    // still passing for a shebang that moved off line 1, which is the only way it can break.
    expect(options.banner.js.split('\n')[0]).toBe('#!/usr/bin/env node')
  })

  it('test_bundled_cjs_can_require_at_load_time', () => {
    // esbuild rewrites a bundled CJS `require(...)` to its `__require` shim, which throws
    // `Dynamic require of "x" is not supported` unless a `require` exists in scope. An ESM module
    // has none, so the banner must build one.
    //
    // Measured 2026-09-17: bundling the TUI pulled in `signal-exit@3.0.7` (an Ink dependency) whose
    // module body runs `assert = require("assert")`. The build was clean and the binary died on
    // startup. Nothing in the build can catch that — which is why it is asserted here.
    expect(options.banner.js).toContain(
      "import { createRequire as __nodeCreateRequire } from 'node:module'",
    )
    expect(options.banner.js).toContain('const require = __nodeCreateRequire(import.meta.url)')
  })

  it('test_ink_devtools_resolves_to_an_empty_module', () => {
    // `react-devtools-core` is a peer Ink declares optional and this app does not install. Ink
    // guards it at runtime, but bundling defeats the guard: esbuild follows the dynamic import into
    // `devtools.js`, whose STATIC import of the package is then hoisted to the top of the bundle.
    //
    // Marking it external was tried first and is the wrong tool — esbuild leaves the unresolved
    // path in the bundle, and the binary died with ERR_MODULE_NOT_FOUND. A plugin that resolves it
    // to an empty module is what makes the bundle self-contained.
    const names = (options.plugins ?? []).map((plugin) => plugin.name)
    expect(names).toContain('ink-devtools-stub')
    expect(options.external).not.toContain('react-devtools-core')
  })

  it('test_it_bundles_the_cli_entry_point', () => {
    expect(options.entryPoints).toHaveLength(1)
    expect(options.entryPoints[0]).toContain('packages/cli/src/main.ts')
  })

  it('test_it_targets_the_engine_the_package_declares', () => {
    // package.json declares `node >= 22`. A lower target silently down-compiles syntax the
    // runtime supports; a higher one emits what it does not.
    expect(options.target).toBe('node22')
  })

  it('test_the_outfile_is_the_path_bin_points_at', () => {
    expect(options.outfile).toBe('/repo/dist/theocode.mjs')
  })

  it('test_the_provider_catalog_is_shipped_beside_the_bundle', () => {
    // A DATA asset esbuild does not bundle. The SDK reads it via `import.meta.url`, i.e. next to
    // the running file. Without it, auto-compaction — context-window management — is silently
    // disabled in every model mode. Nothing fails; long sessions just start losing context.
    expect(DATA_ASSETS).toContain('provider-catalog.json')
  })
})
