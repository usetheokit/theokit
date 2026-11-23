/**
 * Keeps the standalone consumer (`standalone/`) in step with `standalone/released.json`, the exact
 * registry versions that replace the framework's `workspace:*` links.
 *
 *   node tools/sync-standalone.mjs --check   fail on drift in a manifest or the lockfile (default)
 *   node tools/sync-standalone.mjs --write   rewrite the manifest pins from released.json, then report what
 *                                            is still wrong (the lockfile, a non-exact pin) and exit 1
 *
 * After `--write`, regenerate the lockfile: `cd standalone && pnpm install --lockfile-only`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'standalone')
const MANIFESTS = [
  'package.json',
  ...['agent', 'cli', 'shared', 'tui'].map((n) => `packages/${n}/package.json`),
]
const SECTIONS = ['dependencies', 'devDependencies']
const EXACT = /^\d+\.\d+\.\d+$/

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** Rewrites `released` pins in one manifest, or lists the ones that differ. */
function syncManifest(root, file, released, write) {
  const path = join(root, file)
  const manifest = readJson(path)
  const problems = []
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
  return problems
}

function checkLockfile(root, released) {
  const lockPath = join(root, 'pnpm-lock.yaml')
  if (!existsSync(lockPath)) return ['pnpm-lock.yaml is missing']
  const lock = readFileSync(lockPath, 'utf8')
  return Object.entries(released)
    .filter(
      ([name, version]) =>
        !lock.includes(`'${name}':\n        specifier: ${version}\n`) &&
        !lock.includes(`      ${name}:\n        specifier: ${version}\n`),
    )
    .map(([name, version]) => `pnpm-lock.yaml: no importer specifier ${name}@${version}`)
}

/** Returns the drift problems left under `root`; with `write`, fixes manifest pins first. */
export function syncStandalone(root = DEFAULT_ROOT, { write = false } = {}) {
  const released = readJson(join(root, 'released.json'))
  const problems = Object.entries(released)
    .filter(([, version]) => !EXACT.test(version))
    .map(([name, version]) => `released.json: ${name} is "${version}", not an exact version`)
  for (const file of MANIFESTS) problems.push(...syncManifest(root, file, released, write))
  return [...problems, ...checkLockfile(root, released)]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--root')
  const root = at > 0 ? process.argv[at + 1] : DEFAULT_ROOT
  const write = process.argv.includes('--write')
  const problems = syncStandalone(root, { write })
  for (const p of problems) console.error(`standalone drift: ${p}`)
  if (problems.length) process.exit(1)
  console.log(
    write ? 'standalone manifests synchronized' : 'standalone consumer in step with released.json',
  )
}
