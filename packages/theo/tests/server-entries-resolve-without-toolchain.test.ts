import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLCHAIN = ['vite', '@vitejs/plugin-react', 'typescript', 'tsx']
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}

function bareImports(entry: string): Set<string> {
  const seen = new Set<string>()
  const bare = new Set<string>()
  const walk = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const spec = m[1]!
      if (spec.startsWith('.')) walk(resolve(dirname(file), spec))
      else
        bare.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!)
    }
  }
  walk(entry)
  return bare
}

describe('theokit/server entries do not need the build toolchain', () => {
  it('declares the toolchain as optional peers, not dependencies', () => {
    for (const name of TOOLCHAIN) {
      expect(pkg.dependencies[name], name).toBeUndefined()
      expect(pkg.peerDependencies[name], name).toBeDefined()
      expect(pkg.peerDependenciesMeta[name]?.optional, name).toBe(true)
    }
  })

  const built = existsSync(join(ROOT, 'dist/server/agent/index.js'))
  it.skipIf(!built).each(['dist/server/agent/index.js', 'dist/server/webhook/index.js'])(
    '%s imports none of the toolchain',
    (entry) => {
      const bare = bareImports(join(ROOT, entry))
      for (const name of TOOLCHAIN) expect(bare.has(name), name).toBe(false)
    },
  )
})
