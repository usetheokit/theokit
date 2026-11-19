import { mkdtempSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs'
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

const posix = process.platform !== 'win32'
describe('write', () => {
  it.runIf(posix)('writes 0600 in a 0700 directory and round-trips', async () => {
    const d = mk()
    const f = join(d, 'demo', 'demo.env')
    await cfg.write(f, { DEMO_A: 'v 1' }, { force: false })
    expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(statSync(join(d, 'demo')).mode & 0o777).toBe(0o700)
    const env: NodeJS.ProcessEnv = { DEMO_CONFIG: f }
    cfg.load(env, d)
    expect(env).toMatchObject({ DEMO_A: 'v 1' })
    expect(readdirSync(join(d, 'demo'))).toEqual(['demo.env'])
  })
  it('existing file without force throws, no temp file', async () => {
    const d = mk()
    const f = join(d, 'c.env')
    writeFileSync(f, 'DEMO_A="o"\n')
    await expect(cfg.write(f, { DEMO_A: 'n' }, { force: false })).rejects.toBeInstanceOf(
      InstanceConfigError,
    )
    expect(readdirSync(d)).toEqual(['c.env'])
    await cfg.write(f, { DEMO_A: 'n' }, { force: true })
  })
  it('refuses quote values without echoing them', async () => {
    const d = mk()
    const f = join(d, 'c.env')
    const err = await cfg
      .write(f, { DEMO_A: 'sec"ret' }, { force: false })
      .catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(InstanceConfigError)
    expect(err.message).toContain('DEMO_A')
    expect(err.message).not.toContain('sec"ret')
    expect(existsSync(f)).toBe(false)
  })
  it('refuses a failing parse and undeclared keys', async () => {
    const d = mk()
    const f = join(d, 'c.env')
    await expect(cfg.write(f, { DEMO_B: 'bad' }, { force: false })).rejects.toBeInstanceOf(
      InstanceConfigError,
    )
    await expect(cfg.write(f, { NOPE: 'x' } as never, { force: false })).rejects.toBeInstanceOf(
      InstanceConfigError,
    )
    expect(readdirSync(d)).toEqual([])
  })
  it('does not leak the secret through a parser error or its cause', async () => {
    const secret = 'tok-SECRET-123'
    const leaky = defineInstanceConfig({
      app: 'demo',
      keys: {
        DEMO_B: {
          parse: (r) => {
            throw new Error(`cannot parse ${r}`)
          },
        },
      },
    })
    const err = await leaky
      .write(join(mk(), 'c.env'), { DEMO_B: secret }, { force: false })
      .catch((e: unknown) => e as InstanceConfigError)
    expect(err).toBeInstanceOf(InstanceConfigError)
    expect(err.message).not.toContain(secret)
    expect(err.cause).toBeUndefined()
  })
  it('concurrent writers do not collide', async () => {
    const d = mk()
    const f = join(d, 'c.env')
    await Promise.all([1, 2, 3].map((i) => cfg.write(f, { DEMO_A: String(i) }, { force: true })))
    expect(readdirSync(d)).toEqual(['c.env'])
  })
})
