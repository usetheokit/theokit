// Derives this consumer's package.json from TheoCode's real manifests (root and packages/*).
// Every dependency they declare is carried over; `workspace:` specifiers on framework packages are
// replaced with the released version in released.json, and TheoCode's own @theocode/* packages are
// left out (they are source, not a release). `--check` fails when package.json has drifted.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

export function deriveDependencies() {
  const released = readJson(join(here, 'released.json'))
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
            throw new Error(`${name} is a workspace dependency with no entry in released.json`)
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
  const pkg = readJson(path)
  const next = { ...pkg, dependencies: deriveDependencies() }
  if (process.argv.includes('--check')) {
    if (JSON.stringify(pkg.dependencies) !== JSON.stringify(next.dependencies)) {
      console.error('standalone/package.json is out of date: run `node sync-manifest.mjs`')
      process.exit(1)
    }
  } else {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  }
}
