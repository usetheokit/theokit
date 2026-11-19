import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineInstanceConfig, InstanceConfigError } from '../../src/instance-config/index.js'
const mk = () => mkdtempSync(join(tmpdir(), 'ic-'))
const cfg = defineInstanceConfig({
  app: 'demo',
  keys: {
    DEMO_A: {},
    DEMO_B: {
      parse: (r) => {
        if (r === 'bad') throw new Error('x')
        return r
      },
    },
  },
})

describe('load', () => {
  it('keeps env, fills absent, ignores undeclared', () => {
    const d = mk()
    const f = join(d, 'c.env')
    writeFileSync(f, 'DEMO_A="file"\nDEMO_B="fb"\nOTHER="o"\n')
    const env: NodeJS.ProcessEnv = { DEMO_CONFIG: f, DEMO_A: 'env' }
    expect(cfg.load(env, d)).toBe(f)
    expect(env).toMatchObject({ DEMO_A: 'env' })
    expect(env).toMatchObject({ DEMO_B: 'fb' })
    expect(env).not.toHaveProperty('OTHER')
  })
  it('missing explicit file throws naming the variable', () => {
    const d = mk()
    try {
      cfg.load({ DEMO_CONFIG: join(d, 'no.env') }, d)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(InstanceConfigError)
      expect((e as InstanceConfigError).variable).toBe('DEMO_CONFIG')
    }
  })
  it('missing default file returns undefined', () => expect(cfg.load({}, mk())).toBeUndefined())
})
