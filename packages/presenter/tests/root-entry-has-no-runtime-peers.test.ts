/**
 * The root entry loads no peer at runtime, so both peers are optional in the manifest.
 * Reads the BUILT output; without a build the tests skip.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const distDir = resolve(__dirname, '../dist')
const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*["'](\.[^"']+\.js)["']/g
const bareImport = (name: string): RegExp =>
  new RegExp(`(?:from|import)\\s*\\(?\\s*["']${name}(?:/[^"']*)?["']`)

/** The entry file and every file it reaches through relative imports. */
function graph(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [resolve(distDir, entry)]
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      queue.push(resolve(dirname(file), match[1] ?? ''))
    }
  }
  return [...seen]
}

describe('presenter runtime peers', () => {
  it('the root entry imports no zod, @theokit/sdk or ai at runtime', (ctx) => {
    if (!existsSync(resolve(distDir, 'index.js'))) {
      ctx.skip()
      return
    }
    const files = graph('index.js')
    expect(files.length).toBeGreaterThan(1)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const name of ['zod', '@theokit/sdk', 'ai']) {
        expect(source, `${file} imports ${name}`).not.toMatch(bareImport(name))
      }
    }
  })

  it('the wire entry does import zod', (ctx) => {
    if (!existsSync(resolve(distDir, 'index.js'))) {
      ctx.skip()
      return
    }
    // The root build exists, so the wire entry must too: a build without it fails here.
    expect(existsSync(resolve(distDir, 'wire/index.js'))).toBe(true)
    const imports = graph('wire/index.js').some((file) =>
      bareImport('zod').test(readFileSync(file, 'utf8')),
    )
    expect(imports).toBe(true)
  })
})
