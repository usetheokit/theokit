import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    expect(tarText).toContain('report.json')
    expect(tarText).toContain('THEOCLAW_CONTROL_TOKEN')
  })
})
