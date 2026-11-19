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
