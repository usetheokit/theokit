import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<string, unknown>

describe('npm registry install (B-691)', () => {
  const pkg = read('../package.json')

  it('is publishable with a bin and a built-only file list', () => {
    expect(pkg.private).toBeUndefined()
    expect(pkg.bin).toEqual({ theoclaw: './dist/cli.js' })
    expect(pkg.files).toContain('dist')
    expect(pkg.publishConfig).toEqual({ access: 'public' })
    expect(pkg.scripts).toHaveProperty('prepublishOnly')
  })

  it('leaves no OC-30 gap naming B-691', () => {
    const ledger = JSON.stringify(read('../parity/ledger.json'))
    expect(ledger).not.toContain('"B-691"')
  })
})

describe('published tarball contents (B-691)', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))

  it('packs every file the runtime resolves outside dist/', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })
    const packed = (JSON.parse(out) as Array<{ files: Array<{ path: string }> }>)[0]!.files.map((f) => f.path)
    // browser-server.ts resolves ../../tools/browser-proxy.mjs from dist/tools/; browser:install runs install-browser.mjs.
    for (const path of ['package.json', 'tools/browser-proxy.mjs', 'tools/install-browser.mjs']) expect(packed, path).toContain(path)
    const source = readFileSync(join(root, 'src/tools/browser-server.ts'), 'utf8')
    expect(source).toContain("'../../tools/browser-proxy.mjs'")
  })
})
