/**
 * `build:sea`: a single executable (Node SEA) that runs `theoclaw` on a machine without Node (OC-122).
 * Bundles `dist/cli.js` (run `pnpm build` first) into one CommonJS file, then injects it into a copy of
 * the running `node` binary. Usage: `node tools/build-sea.mjs [outFile]` (default `dist/sea/theoclaw`).
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const POSTJECT = 'postject@1.0.0-alpha.6'
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

/** esbuild options for the bundle: CJS (SEA runs a script, not a module) with import.meta.url rewritten. */
export function bundleOptions(version, outfile) {
  return {
    absWorkingDir: APP_DIR,
    entryPoints: ['dist/cli.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    logLevel: 'warning',
    define: {
      __THEOCLAW_VERSION__: JSON.stringify(version),
      'import.meta.url': '__theoclawImportMetaUrl',
    },
    banner: { js: "const __theoclawImportMetaUrl = require('node:url').pathToFileURL(process.execPath).href;" },
  }
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`build:sea: ${cmd} ${args.join(' ')} failed`)
}

export async function main(argv) {
  const out = resolve(APP_DIR, argv[0] ?? 'dist/sea/theoclaw')
  const dir = dirname(out)
  mkdirSync(dir, { recursive: true })
  const { version } = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8'))
  const bundle = join(dir, 'theoclaw.cjs')
  await build(bundleOptions(version, bundle))
  const blob = join(dir, 'sea-prep.blob')
  const config = join(dir, 'sea-config.json')
  writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }))
  run(process.execPath, ['--experimental-sea-config', config])
  copyFileSync(process.execPath, out)
  chmodSync(out, 0o755)
  run('npx', ['--yes', POSTJECT, out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', FUSE])
  process.stdout.write(`build:sea: ${out}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
