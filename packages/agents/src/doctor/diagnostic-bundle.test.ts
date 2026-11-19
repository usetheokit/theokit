/* eslint-disable sonarjs/no-os-command-from-path -- tar is the reference extractor */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
    const d = dirname(out)
    await writeDiagnosticBundle({
      out,
      files: [{ name: 'a.txt', content: 'k=s3cret' }],
      secrets: ['s3cret'],
      mask: (t) => t.replace('s3cret', '***'),
    })
    const x = join(d, 'x')
    mkdirSync(x)
    execFileSync('tar', ['-xzf', out, '-C', x])
    expect(readFileSync(join(x, 'a.txt'), 'utf8')).toBe('k=***')
  })

  it('an error message never contains a secret, even one that occurs in the message text', async () => {
    for (const secret of ['redacted', 'refused', 'Diagnostic', 'bundle refused']) {
      const err = await writeDiagnosticBundle({
        out: join(dir(), 'b.tar.gz'),
        files: [{ name: secret, content: secret }],
        secrets: [secret],
      }).catch((e: unknown) => e)
      expect((err as DiagnosticBundleError).reason).toBe('secret_survived')
      expect((err as Error).message).not.toContain(secret)
    }
    const long = 'x'.repeat(101)
    const err = await writeDiagnosticBundle({
      out: join(dir(), 'b.tar.gz'),
      files: [{ name: long, content: '' }],
      secrets: ['xxx'],
    }).catch((e: unknown) => e)
    expect((err as Error).message).not.toContain('xxx')
  })

  it('the message still names the file when only its fixed wording holds the secret', async () => {
    const err = await writeDiagnosticBundle({
      out: join(dir(), 'b.tar.gz'),
      files: [{ name: 'report.txt', content: 'Diagnostic' }],
      secrets: ['Diagnostic'],
    }).catch((e: unknown) => e)
    expect((err as Error).message).toContain('report.txt')
    expect((err as Error).message).not.toContain('Diagnostic')
  })

  it('a secret that encoding introduces (U+FFFD from a lone surrogate) is refused', async () => {
    const out = join(dir(), 'b.tar.gz')
    await expect(
      writeDiagnosticBundle({
        out,
        files: [{ name: 'a', content: 'a\ud800b' }],
        secrets: ['\ufffd'],
      }),
    ).rejects.toMatchObject({ reason: 'secret_survived' })
    expect(existsSync(out)).toBe(false)
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
