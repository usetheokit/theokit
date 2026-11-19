import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DiagnosticBundleError, writeDiagnosticBundle } from './diagnostic-bundle.js'

const dir = () => mkdtempSync(join(tmpdir(), 'bundle-'))

describe('writeDiagnosticBundle', () => {
  it('the archive extracts with tar and holds each file unchanged', async () => {
    const d = dir()
    const out = join(d, 'b.tar.gz')
    const files = [
      { name: 'report.json', content: '{"a":1}' },
      { name: 'big.log', content: 'é'.repeat(700) },
    ]
    const r = await writeDiagnosticBundle({ out, files, secrets: [] })
    expect(r.path).toBe(out)
    expect(r.bytes).toBe(statSync(out).size)
    const x = join(d, 'x')
    execFileSync('mkdir', [x])
    execFileSync('tar', ['-xzf', out, '-C', x])
    for (const f of files) expect(readFileSync(join(x, f.name), 'utf8')).toBe(f.content)
  })

  it('a secret that survives the mask writes nothing and throws secret_survived', async () => {
    const out = join(dir(), 'b.tar.gz')
    const err = await writeDiagnosticBundle({
      out,
      files: [{ name: 'a.txt', content: 'token=hunter2hunter2' }],
      secrets: ['hunter2hunter2'],
      mask: (t) => t.replace('token', 'tok'),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DiagnosticBundleError)
    expect((err as DiagnosticBundleError).reason).toBe('secret_survived')
    expect((err as Error).message).toContain('a.txt')
    expect((err as Error).message).not.toContain('hunter2hunter2')
    expect(existsSync(out)).toBe(false)
  })

  it('a mask that removes the secret lets the bundle through', async () => {
    const out = join(dir(), 'b.tar.gz')
    await writeDiagnosticBundle({
      out,
      files: [{ name: 'a.txt', content: 'k=s3cret' }],
      secrets: ['s3cret'],
      mask: (t) => t.replace('s3cret', '***'),
    })
    expect(existsSync(out)).toBe(true)
  })

  it('a name over 100 bytes throws name_too_long', async () => {
    const out = join(dir(), 'b.tar.gz')
    await expect(
      writeDiagnosticBundle({ out, files: [{ name: 'é'.repeat(51), content: 'x' }], secrets: [] }),
    ).rejects.toMatchObject({ reason: 'name_too_long' })
    await writeDiagnosticBundle({
      out,
      files: [{ name: 'é'.repeat(50), content: 'x' }],
      secrets: [],
    })
    expect(existsSync(out)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('the archive is written with mode 0600', async () => {
    const out = join(dir(), 'b.tar.gz')
    await writeDiagnosticBundle({ out, files: [{ name: 'a', content: 'x' }], secrets: [] })
    expect(statSync(out).mode & 0o777).toBe(0o600)
  })
})
