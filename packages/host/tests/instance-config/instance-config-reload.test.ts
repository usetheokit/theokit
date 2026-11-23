import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineInstanceConfig } from '../../src/instance-config/index.js'

const SECRET = 'distinctive-value-9f3a'
const cfg = defineInstanceConfig({
  app: 'demo',
  keys: {
    DEMO_HOT: { hot: true },
    DEMO_NUM: {
      hot: true,
      parse: (r) => {
        if (r.startsWith('bad')) throw new Error(`bad ${r}`)
        return r
      },
    },
    DEMO_COLD: {},
  },
})
const file = (text: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'icr-')), 'c.env')
  writeFileSync(f, text)
  return f
}

describe('reload', () => {
  it('applies a changed hot key', () => {
    const f = file(`DEMO_HOT=${SECRET}\n`)
    const env: NodeJS.ProcessEnv = { DEMO_HOT: 'old' }
    const r = cfg.reload(f, env, { DEMO_HOT: 'old' })
    expect(env.DEMO_HOT).toBe(SECRET)
    expect(r.result).toEqual({ kind: 'applied', applied: ['DEMO_HOT'], restartRequired: [] })
    expect(JSON.stringify(r.result)).not.toContain(SECRET)
    expect(cfg.reload(f, env, r.accepted).result).toEqual({ kind: 'unchanged' })
  })
  it('leaves a caller-set hot key alone', () => {
    const f = file('DEMO_HOT=new\n')
    const env: NodeJS.ProcessEnv = { DEMO_HOT: 'caller' }
    const r = cfg.reload(f, env, { DEMO_HOT: 'old' })
    expect(env.DEMO_HOT).toBe('caller')
    expect(r.result.kind).toBe('unchanged')
  })
  it('lists a changed non-hot key and does not apply it', () => {
    const f = file(`DEMO_COLD=${SECRET}\nOTHER=1\n`)
    const env: NodeJS.ProcessEnv = {}
    const r = cfg.reload(f, env, {})
    expect(env.DEMO_COLD).toBeUndefined()
    expect(r.result).toEqual({
      kind: 'applied',
      applied: [],
      restartRequired: ['DEMO_COLD', 'OTHER'],
    })
    expect(JSON.stringify(r.result)).not.toContain(SECRET)
  })
  it('refuses a file whose hot key fails parse, env and snapshot unchanged', () => {
    const f = file(`DEMO_HOT=ok\nDEMO_NUM=bad${SECRET}\n`)
    const env: NodeJS.ProcessEnv = { DEMO_HOT: 'old' }
    const prev = { DEMO_HOT: 'old' }
    const r = cfg.reload(f, env, prev)
    expect(r.result.kind).toBe('refused')
    expect(env).toEqual({ DEMO_HOT: 'old' })
    expect(r.accepted).toBe(prev)
    expect(JSON.stringify(r.result)).not.toContain(SECRET)
  })
  it('refuses a missing file', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(cfg.reload(join(tmpdir(), 'nope-icr', 'x.env'), env, {}).result.kind).toBe('refused')
  })
})

describe('reload validation sees the successor', () => {
  it('passes the changed start-only keys as the successor and skips validation when nothing changed', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { reloadInstanceConfig } = await import('../../src/instance-config/reload.js')
    const f = join(mkdtempSync(join(tmpdir(), 'ic-')), 'c.env')
    writeFileSync(f, 'H="2"\nS="2"\n')
    const calls: Array<[unknown, unknown]> = []
    const env: NodeJS.ProcessEnv = { H: '1', S: '1' }
    const out = reloadInstanceConfig({ H: { hot: true } }, f, env, { H: '1', S: '1' }, (c, s) => {
      calls.push([{ ...c }, { ...s }])
    })
    expect(out.result).toEqual({ kind: 'applied', applied: ['H'], restartRequired: ['S'] })
    expect(calls).toEqual([
      [
        { H: '2', S: '1' },
        { H: '2', S: '2' },
      ],
    ])
    reloadInstanceConfig({ H: { hot: true } }, f, env, out.accepted, () => calls.push([0, 0]))
    expect(calls).toHaveLength(1)
  })
})
