/**
 * Keeps the standalone consumer (`standalone/`) in step with `standalone/released.json`, the exact
 * registry versions that replace the framework's `workspace:*` links.
 *
 *   node tools/sync-standalone.mjs --check   fail on drift in a manifest or the lockfile (default)
 *   node tools/sync-standalone.mjs --write   rewrite the manifest pins from released.json
 *
 * After `--write`, regenerate the lockfile: `cd standalone && pnpm install --lockfile-only`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'standalone')
const MANIFESTS = ['package.json', ...['agent', 'cli', 'shared', 'tui'].map((n) => `packages/${n}/package.json`)]
const SECTIONS = ['dependencies', 'devDependencies']
const EXACT = /^\d+\.\d+\.\d+$/

/** Returns the drift problems found under `root`; with `write`, fixes manifest pins first. */
export function syncStandalone(root = DEFAULT_ROOT, { write = false } = {}) {
  const problems = []
  const released = JSON.parse(readFileSync(join(root, 'released.json'), 'utf8'))
  for (const [name, version] of Object.entries(released)) {
    if (!EXACT.test(version)) problems.push(`released.json: ${name} is "${version}", not an exact version`)
  }
  for (const file of MANIFESTS) {
    const path = join(root, file)
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    let changed = false
    for (const section of SECTIONS) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (!(name in released) || range === released[name]) continue
        if (write) {
          manifest[section][name] = released[name]
          changed = true
        } else problems.push(`${file}: ${name} is "${range}", released.json says ${released[name]}`)
      }
    }
    if (changed) writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  const lockPath = join(root, 'pnpm-lock.yaml')
  if (!existsSync(lockPath)) problems.push('pnpm-lock.yaml is missing')
  else {
    const lock = readFileSync(lockPath, 'utf8')
    for (const [name, version] of Object.entries(released)) {
      if (!lock.includes(`'${name}':\n        specifier: ${version}\n`))
        problems.push(`pnpm-lock.yaml: no importer specifier ${name}@${version}`)
    }
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write')
  const problems = syncStandalone(DEFAULT_ROOT, { write })
  for (const p of problems) console.error(`standalone drift: ${p}`)
  if (problems.length && !write) process.exit(1)
  console.log(write ? 'standalone manifests synchronized' : 'standalone consumer in step with released.json')
}
