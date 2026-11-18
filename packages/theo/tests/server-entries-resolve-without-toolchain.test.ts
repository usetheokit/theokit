import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

  const entries = ['dist/server/agent/index.js', 'dist/server/webhook/index.js']

  it.each(entries)('%s is built and imports none of the toolchain', (entry) => {
    expect(existsSync(join(ROOT, entry)), `${entry} missing: run the theokit build first`).toBe(
      true,
    )
    const bare = bareImports(join(ROOT, entry))
    for (const name of TOOLCHAIN) expect(bare.has(name), name).toBe(false)
  })

  it.each(entries)('%s loads when the toolchain cannot be resolved', (entry) => {
    const hook = `data:text/javascript,${encodeURIComponent(
      `const blocked = ${JSON.stringify(TOOLCHAIN)}
export async function resolve(spec, ctx, next) {
  if (blocked.some((n) => spec === n || spec.startsWith(n + '/'))) throw new Error('blocked ' + spec)
  return next(spec, ctx)
}`,
    )}`
    const boot = `import { register } from 'node:module'; register(${JSON.stringify(hook)}); await import(${JSON.stringify(pathToFileURL(join(ROOT, entry)).href)})`
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', boot], {
      encoding: 'utf8',
    })
    expect(out.stderr).toBe('')
    expect(out.status).toBe(0)
  })

  it('the CLI binary starts without tsx and does not import it statically', () => {
    const cli = join(ROOT, 'dist/cli/index.js')
    expect(existsSync(cli), 'dist/cli/index.js missing: run the theokit build first').toBe(true)
    expect(readFileSync(cli, 'utf8')).not.toMatch(/^import ["']tsx\/esm["']/m)
    const hook = `data:text/javascript,${encodeURIComponent(
      `export async function resolve(spec, ctx, next) {
  if (spec === 'tsx' || spec.startsWith('tsx/')) throw Object.assign(new Error('blocked'), { code: 'ERR_MODULE_NOT_FOUND' })
  return next(spec, ctx)
}`,
    )}`
    const boot = `import { register } from 'node:module'; register(${JSON.stringify(hook)}); process.argv[1] = ${JSON.stringify(cli)}; await import(${JSON.stringify(pathToFileURL(cli).href)})`
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', boot, '--', '--help'], {
      encoding: 'utf8',
    })
    expect(out.status).toBe(0)
  })
})
