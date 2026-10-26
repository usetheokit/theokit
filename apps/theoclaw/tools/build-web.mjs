/**
 * `build:web`: bundle the WebChat page into `dist/web/assets/app.js` and `app.css`, one esbuild call
 * (plan D4), then fail when the two together exceed the page's budget (NFR-003).
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = 'dist/web/assets'
/** 3 MiB: the budget the plan sets for the page, measured on the two files the build writes. */
const BUDGET_BYTES = 3_145_728

await build({
  absWorkingDir: APP_DIR,
  entryPoints: ['web/main.tsx'],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  outdir: OUT_DIR,
  entryNames: 'app',
  loader: { '.css': 'css' },
  // React ships its development build unless NODE_ENV is replaced at build time.
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})

const bytes = ['app.js', 'app.css'].reduce((total, name) => total + statSync(join(APP_DIR, OUT_DIR, name)).size, 0)
if (bytes > BUDGET_BYTES) {
  process.stderr.write(`build:web: the bundle is ${bytes} bytes, over the ${BUDGET_BYTES}-byte budget\n`)
  process.exit(1)
}
process.stdout.write(`build:web: ${OUT_DIR}/app.js and app.css, ${bytes} bytes\n`)
