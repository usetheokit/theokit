import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { THEOCODE_PROTECTED_ENV_KEYS } from '../../src/bootstrap/bootstrap-surface.js'
import { bootstrapSurface } from '../../src/bootstrap/index.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function project(env: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'penv-'))
  dirs.push(dir)
  writeFileSync(join(dir, '.env'), env)
  return dir
}

describe('bootstrapSurface project .env', () => {
  it('protects every SDK sovereign key and TheoCode keys', async () => {
    for (const k of ['THEOCODE_TRUST_ALL_DIRS', 'THEOKIT_TRUST_ALL_DIRS', 'THEOCODE_HOME'])
      expect(THEOCODE_PROTECTED_ENV_KEYS).toContain(k)
    const cwd = project(`${SOVEREIGN_ENV_KEYS.map((k) => `${k}=evil`).join('\n')}\n`)
    const env: Record<string, string | undefined> = {}
    await bootstrapSurface({ env, cwd, home: cwd, onWarn: () => {} })
    for (const k of SOVEREIGN_ENV_KEYS) expect(env[k]).not.toBe('evil')
  })

  it('a .env cannot set sovereign keys (absent and present)', async () => {
    const cwd = project(
      'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\nTHEOCODE_TRUST_ALL_DIRS=1\nOTHER=1\n',
    )
    const home = mkdtempSync(join(tmpdir(), 'penv-home-'))
    dirs.push(home)
    const env: Record<string, string | undefined> = { THEOKIT_TRUSTED_PROVIDERS: 'real' }

    await bootstrapSurface({ env, cwd, home, onWarn: () => {} })

    expect(env.THEOKIT_TRUSTED_PROVIDERS).toBe('real')
    expect(env.THEOKIT_REDACT_SECRETS).toBeUndefined()
    expect(env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
    expect(env.THEOCODE_TRUST_ALL_DIRS).toBeUndefined()
    expect(env.OTHER).toBe('1')
  })

  it('a .env cannot move the installed home or auth home', async () => {
    const cwd = project('THEOKIT_HOME=/evil\nTHEOKIT_AUTH_HOME=/evil\n')
    const home = mkdtempSync(join(tmpdir(), 'penv-home-'))
    dirs.push(home)
    const env: Record<string, string | undefined> = {}

    await bootstrapSurface({ env, cwd, home, onWarn: () => {} })

    expect(env.THEOKIT_HOME).not.toBe('/evil')
    expect(env.THEOKIT_AUTH_HOME).not.toBe('/evil')
  })

  it('the real process.env: a .env in the selected cwd cannot set sovereign keys', async () => {
    const cwd = project('THEOKIT_REDACT_SECRETS=false\nTHEOKIT_OAUTH_TX_SALT=y\n')
    const saved = { ...process.env }
    try {
      await bootstrapSurface({ env: process.env, cwd, home: cwd, onWarn: () => {} })
      expect(process.env.THEOKIT_REDACT_SECRETS).toBeUndefined()
      expect(process.env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  })
})

describe('the record bootstrapSurface returns', () => {
  async function record(contents: string, env: Record<string, string | undefined> = {}) {
    const cwd = project(contents)
    const ctx = await bootstrapSurface({ env, cwd, home: cwd, onWarn: () => {} })
    return { cwd, rec: ctx.projectEnv! }
  }

  it('names the file, the loaded keys and the refused keys', async () => {
    const { cwd, rec } = await record('A=1\nTHEOCODE_TRUST_ALL_DIRS=1\nB=2\n')
    expect(rec.file).toBe(join(cwd, '.env'))
    expect(rec.loaded).toEqual(['A', 'B'])
    expect(rec.refused).toEqual(['THEOCODE_TRUST_ALL_DIRS'])
  })

  it('leaves a key the environment already had out of loaded', async () => {
    const env = { A: 'shell' }
    const { rec } = await record('A=file\nB=2\n', env)
    expect(rec.loaded).toEqual(['B'])
    expect(env.A).toBe('shell')
  })

  it('records an empty load when there is no .env', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'penv-'))
    dirs.push(cwd)
    const ctx = await bootstrapSurface({ env: {}, cwd, home: cwd, onWarn: () => {} })
    expect(ctx.projectEnv?.loaded).toEqual([])
  })

  it('does not read a name from inside a multiline value', async () => {
    const { rec } = await record('NOTE="first\nANTHROPIC_API_KEY=not-a-declaration\nlast"\n')
    expect(rec.loaded).toEqual(['NOTE'])
  })

  it('reads plain, export-prefixed, commented and CRLF files', async () => {
    expect((await record('A=1\nOPENAI=2\n')).rec.loaded).toEqual(['A', 'OPENAI'])
    expect((await record('export A=1\n# c\n\nB=2\n')).rec.loaded).toEqual(['A', 'B'])
    expect((await record('A=1\r\nB=2\r\n')).rec.loaded).toEqual(['A', 'B'])
  })

  it('keeps the declarations after multiline values, however they close', async () => {
    expect((await record('A="one line"\nB=2\n')).rec.loaded).toEqual(['A', 'B'])
    expect((await record('A="first\nlast"\nB=2\n')).rec.loaded).toEqual(['A', 'B'])
    expect((await record("A='first\nlast'\nB=2\n")).rec.loaded).toEqual(['A', 'B'])
    expect((await record('A="first\nmiddle\n"\nB=2\n')).rec.loaded).toEqual(['A', 'B'])
  })

  it('ignores lines with no name or no equals sign', async () => {
    expect((await record('=V\nNO_EQUALS\nGOOD=y\n')).rec.loaded).toEqual(['GOOD'])
  })

  it('pins the framework parser: a non-identifier name is loaded (it can never match a credential varName)', async () => {
    expect((await record('1BAD=x\nGOOD=y\n')).rec.loaded).toEqual(['1BAD', 'GOOD'])
  })

  it('pins the framework parser: an unterminated quote does not swallow the lines below it', async () => {
    expect((await record('A="never closed\nB=2\n')).rec.loaded).toEqual(['A', 'B'])
  })
})
