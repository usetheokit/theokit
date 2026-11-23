#!/usr/bin/env node
// M61 — build the distributable `exec` bundle: a single self-contained ESM file that runs
// goal/review/run/sessions WITHOUT tsx or the dev toolchain. Mirrors the repo's `acp:bundle` precedent
// (esbuild ESM). ESM is mandatory — a CJS bundle breaks `import.meta.url` (SDK persistence → "path
// undefined"). The one native runtime dep, node-pty, is EXTERNAL (loaded via createRequire, esbuild does
// not follow it) and only touched by run/resume's interactive_shell — goal/review never need it.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The esbuild settings (ESM, externals, Ink devtools stub, React pinned to production, createRequire
// banner) and the reasons for each live in create-theokit, shared with the scaffolded TUI's build:bin.
import {
  buildInkCli,
  inkCliBundleOptions,
  isReactRuntimeFile,
  pinReactToProduction,
} from 'create-theokit/tools/build-ink-cli.mjs'

export { isReactRuntimeFile, pinReactToProduction }

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The esbuild configuration, as a value: TheoCode's entry and output over the shared settings. */
export function bundleOptions(root = REPO_ROOT) {
  return inkCliBundleOptions({
    entry: join(root, 'packages', 'cli', 'src', 'main.ts'),
    outfile: join(root, 'dist', 'theocode.mjs'),
  })
}

/**
 * Builds the bundle. Nothing is copied beside it: the SDK imports its provider catalog with
 * `with { type: "json" }`, so a bundler inlines it and there is no file to place (2026-09-28).
 */
export async function buildCli(root = REPO_ROOT) {
  return buildInkCli({
    entry: join(root, 'packages', 'cli', 'src', 'main.ts'),
    outfile: join(root, 'dist', 'theocode.mjs'),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outfile = await buildCli()
  process.stdout.write(`built ${outfile}\n`)
}
