import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineInstanceConfig, InstanceConfigError } from '../../src/instance-config/index.js'
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

describe('path', () => {
  it('explicit wins', () =>
    expect(cfg.path({ DEMO_CONFIG: '/x/y.env', XDG_CONFIG_HOME: '/z' }, '/h')).toBe('/x/y.env'))
  it('xdg then home', () => {
    expect(cfg.path({ XDG_CONFIG_HOME: '/z' }, '/h')).toBe('/z/demo/demo.env')
    expect(cfg.path({}, '/h')).toBe('/h/.config/demo/demo.env')
  })
  it('profile', () =>
    expect(cfg.path({ DEMO_PROFILE: 'work' }, '/h')).toBe('/h/.config/demo/demo-work.env'))
  it('refuses bad names', () => {
    expect(() => defineInstanceConfig({ app: 'Bad', keys: {} })).toThrow(InstanceConfigError)
    expect(() => cfg.path({ DEMO_PROFILE: '../x' }, '/h')).toThrow(InstanceConfigError)
  })
})

describe('custom variable names', () => {
  const custom = defineInstanceConfig({
    app: 'demo',
    keys: { DEMO_A: {} },
    pathVariable: 'MY_FILE',
    profileVariable: 'MY_PROFILE',
  })
  it('uses the custom path variable and ignores the default one', () => {
    expect(custom.path({ MY_FILE: '/x/y.env', DEMO_CONFIG: '/no' }, '/h')).toBe('/x/y.env')
    expect(custom.path({ DEMO_CONFIG: '/no' }, '/h')).toBe('/h/.config/demo/demo.env')
  })
  it('uses the custom profile variable and ignores the default one', () => {
    expect(custom.path({ MY_PROFILE: 'work' }, '/h')).toBe('/h/.config/demo/demo-work.env')
    expect(custom.path({ DEMO_PROFILE: 'work' }, '/h')).toBe('/h/.config/demo/demo.env')
    expect(() => custom.path({ MY_PROFILE: '../x' }, '/h')).toThrow(InstanceConfigError)
  })
  it('loads an explicit file from the custom variable and names it when missing', () => {
    const d = mkdtempSync(join(tmpdir(), 'ic-'))
    const f = join(d, 'c.env')
    writeFileSync(f, 'DEMO_A="v"\n')
    const env: NodeJS.ProcessEnv = { MY_FILE: f }
    expect(custom.load(env, d)).toBe(f)
    expect(env.DEMO_A).toBe('v')
    const err = (() => {
      try {
        custom.load({ MY_FILE: join(d, 'missing.env') }, d)
      } catch (e) {
        return e as InstanceConfigError
      }
    })()
    expect(err).toBeInstanceOf(InstanceConfigError)
    expect(err?.variable).toBe('MY_FILE')
  })
})

describe('built subpath', () => {
  it('declares the export and the built entry exposes the API', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.exports['./instance-config'].import).toBe('./dist/instance-config/index.js')
    const built = await import(new URL('../../dist/instance-config/index.js', import.meta.url).href)
    expect(typeof built.defineInstanceConfig).toBe('function')
    expect(typeof built.InstanceConfigError).toBe('function')
  })
})
