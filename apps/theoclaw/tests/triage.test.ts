import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { triageCommand } from '../src/ops/triage.js'

describe('theoclaw triage', () => {
  it('writes an archive and a prompt holding no configured secret', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-'))
    const token = 'tok-ABCDEF0123456789-secret'
    const log = join(dir, 'app.log')
    writeFileSync(log, `started with ${token}\nok\n`)
    const stdout = new PassThrough()
    const code = await triageCommand(['--out', join(dir, 'out')], {
      env: { THEOCLAW_CONTROL_TOKEN: token, THEOCLAW_LOG_FILE: log, THEOCLAW_CONFIG: join(dir, 'none.env') },
      homeDir: dir,
      cwd: dir,
      stdout,
      stderr: new PassThrough(),
    })
    expect(code).toBe(0)
    const files = readdirSync(join(dir, 'out'))
    expect(files.some((f) => f.endsWith('.tar.gz'))).toBe(true)
    for (const f of files) {
      const raw = readFileSync(join(dir, 'out', f))
      const text = (f.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')
      expect(text).not.toContain(token)
    }
    const tarText = gunzipSync(readFileSync(join(dir, 'out', files.find((f) => f.endsWith('.gz'))!))).toString('utf8')
    const archive = files.find((f) => f.endsWith('.gz'))!
    expect(statSync(join(dir, 'out', archive)).mode & 0o777).toBe(0o600)
    expect(tarText).toContain('report.json')
    expect(tarText).toContain('THEOCLAW_CONTROL_TOKEN')
  })

  async function refuse(env: NodeJS.ProcessEnv, log?: string) {
    const dir = mkdtempSync(join(tmpdir(), 'triage-'))
    if (log !== undefined) writeFileSync(join(dir, 'app.log'), log)
    const stderr = new PassThrough()
    let text = ''
    stderr.on('data', (chunk: Buffer) => (text += chunk.toString()))
    const code = await triageCommand(['--out', join(dir, 'out')], {
      env: { THEOCLAW_CONFIG: join(dir, 'none.env'), ...(log === undefined ? {} : { THEOCLAW_LOG_FILE: join(dir, 'app.log') }), ...env },
      homeDir: dir,
      cwd: dir,
      stdout: new PassThrough(),
      stderr,
    })
    return { code, text, out: join(dir, 'out') }
  }

  it('refuses when a secret survives in an archive file name, writing nothing', async () => {
    // "report" is the name of report.json: masking contents cannot remove it.
    const { code, text, out } = await refuse({ THEOCLAW_CONTROL_TOKEN: 'report' })
    expect(code).toBe(1)
    expect(text).toBe('theoclaw triage: a secret value survived masking; nothing was written\n')
    expect(existsSync(out)).toBe(false)
  })

  it('refuses when a secret survives in the prompt, writing nothing', async () => {
    // Masking "triage" writes "[redacted]", which holds the second secret "edact".
    const { code, text, out } = await refuse({ THEOCLAW_CONTROL_TOKEN: 'triage', THEOCLAW_API_KEY: 'edact' }, 'x')
    expect(code).toBe(1)
    expect(text).toBe('theoclaw triage: a secret value survived masking; nothing was written\n')
    expect(existsSync(out)).toBe(false)
  })
})
