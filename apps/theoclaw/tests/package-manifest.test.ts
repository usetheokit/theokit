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
