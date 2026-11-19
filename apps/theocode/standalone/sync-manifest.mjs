// Derives this consumer's package.json from TheoCode's real manifests (root and packages/*).
// Every dependency they declare is carried over; `workspace:` specifiers on framework packages are
// replaced with the released version in released.json, and TheoCode's own @theocode/* packages are
// left out (they are source, not a release). `--check` fails when package.json has drifted.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

export function deriveDependencies({
  root = join(here, '..'),
  released = {},
} = {}) {
  const dirs = readdirSync(join(root, 'packages'), { withFileTypes: true }).filter((d) =>
    d.isDirectory(),
  )
  const files = [
    join(root, 'package.json'),
    ...dirs.map((d) => join(root, 'packages', d.name, 'package.json')),
  ]
  const out = {}
  for (const file of files) {
    const m = readJson(file)
    for (const deps of [m.dependencies, m.devDependencies]) {
      for (const [name, declared] of Object.entries(deps ?? {})) {
        if (name.startsWith('@theocode/')) continue
        let spec = declared
        if (declared.startsWith('workspace:')) {
          spec = released[name]
          if (!spec)
            throw new Error(
              `${name} is a workspace dependency (${file}) with no entry in released.json: add it with the released version`,
            )
        }
        if (out[name] !== undefined && out[name] !== spec) {
          throw new Error(`${name}: conflicting specs ${out[name]} and ${spec} (${file})`)
        }
        out[name] = spec
      }
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = join(here, 'package.json')
  const releasedPath = join(here, 'released.json')
  let pkg
  let next
  try {
    if (!existsSync(path)) throw new Error(`${path} not found: nothing to synchronize`)
    pkg = readJson(path)
    // released.json is optional: without it, workspace dependencies have no pin and are reported.
    const released = existsSync(releasedPath) ? readJson(releasedPath) : {}
    next = { ...pkg, dependencies: deriveDependencies({ released }) }
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
  if (process.argv.includes('--check')) {
    if (JSON.stringify(pkg.dependencies) !== JSON.stringify(next.dependencies)) {
      console.error(
        'standalone/package.json is out of date: run `node sync-manifest.mjs`, then `pnpm install`, and commit package.json, pnpm-lock.yaml and, if you changed a pin, released.json',
      )
      process.exit(1)
    }
  } else {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  }
}
