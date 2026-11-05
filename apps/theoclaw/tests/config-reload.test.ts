import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { configurationReloader } from '../src/config-file.js'

it('reloads changed and removed file settings while preserving environment overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reload-'))
  try {
    const path = join(dir, 'config')
    const env: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: path, OVERRIDE: 'caller' }
    const reload = configurationReloader(env, dir)
    writeFileSync(path, 'THEOCLAW_MODEL=first\nOLD=yes\nOVERRIDE=file')
    reload()
    expect(env.THEOCLAW_MODEL).toBe('first')
    writeFileSync(path, 'THEOCLAW_MODEL=second')
    reload()
    expect(env.THEOCLAW_MODEL).toBe('second')
    expect(env.OLD).toBeUndefined()
    expect(env.OVERRIDE).toBe('caller')
    rmSync(path)
    expect(reload).toThrow()
    expect(env.THEOCLAW_MODEL).toBe('second')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
