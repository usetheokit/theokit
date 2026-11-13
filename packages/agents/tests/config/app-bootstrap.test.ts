import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import {
  BootstrapNotRunError,
  BootstrapStepError,
  assertBootstrapped,
  defineAppBootstrap,
  projectEnvStep,
  type BootstrapContext,
} from '../../src/config/app-bootstrap.js'

const ctx = (over: Partial<BootstrapContext> = {}): BootstrapContext => ({
  env: {},
  cwd: '/tmp',
  home: '/tmp/home',
  ...over,
})

describe('defineAppBootstrap', () => {
  it('steps run once in declaration order', async () => {
    const calls: string[] = []
    const b = defineAppBootstrap([
      {
        name: 'a',
        run: () => {
          calls.push('a')
        },
      },
      {
        name: 'b',
        run: async () => {
          calls.push('b')
        },
      },
    ])
    expect(b.steps).toEqual(['a', 'b'])
    expect(b.done).toBe(false)
    const first = b.run(ctx())
    expect(await first).toEqual({ ran: ['a', 'b'] })
    expect(b.run(ctx())).toBe(first)
    await b.run(ctx())
    expect(calls).toEqual(['a', 'b'])
    expect(b.done).toBe(true)
  })

  it('a failing step throws BootstrapStepError naming the step and skips the rest', async () => {
    const calls: string[] = []
    const boom = new Error('boom')
    const b = defineAppBootstrap([
      {
        name: 'one',
        run: () => {
          calls.push('one')
        },
      },
      {
        name: 'two',
        run: () => {
          throw boom
        },
      },
      {
        name: 'three',
        run: () => {
          calls.push('three')
        },
      },
    ])
    const err = await b.run(ctx()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BootstrapStepError)
    expect((err as BootstrapStepError).message).toContain('two')
    expect((err as BootstrapStepError).code).toBe('bootstrap_step_failed')
    expect((err as BootstrapStepError).cause).toBe(boom)
    expect(calls).toEqual(['one'])
    expect(b.done).toBe(false)
  })

  it('duplicate step names throw at definition', () => {
    const noop = (): void => undefined
    expect(() =>
      defineAppBootstrap([
        { name: 'x', run: noop },
        { name: 'x', run: noop },
      ]),
    ).toThrow(/Duplicate.*"x"/)
  })
})

describe('assertBootstrapped', () => {
  it('assertBootstrapped throws BootstrapNotRunError naming the caller before run and passes after', async () => {
    const b = defineAppBootstrap([{ name: 'a', run: () => undefined }])
    expect(() => assertBootstrapped(b, 'resolveHome')).toThrow(BootstrapNotRunError)
    expect(() => assertBootstrapped(b, 'resolveHome')).toThrow(/resolveHome/)
    await b.run(ctx())
    expect(() => assertBootstrapped(b, 'resolveHome')).not.toThrow()
  })
})

describe('projectEnvStep', () => {
  const dirs: string[] = []
  const saved: Record<string, string | undefined> = {}
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Reflect.deleteProperty(process.env, k)
      else process.env[k] = v
    }
  })

  it('projectEnvStep loads .env and refuses a sovereign key', async () => {
    const sovereign = SOVEREIGN_ENV_KEYS[0] as string
    const plain = 'APP_BOOTSTRAP_TEST_PLAIN'
    for (const k of [sovereign, plain]) saved[k] = process.env[k]
    Reflect.deleteProperty(process.env, plain)
    Reflect.deleteProperty(process.env, sovereign)
    const dir = mkdtempSync(join(tmpdir(), 'app-bootstrap-'))
    dirs.push(dir)
    writeFileSync(join(dir, '.env'), `${plain}=hello\n${sovereign}=from-project\n`)

    await defineAppBootstrap([projectEnvStep]).run(ctx({ env: process.env, cwd: dir }))

    expect(process.env[plain]).toBe('hello')
    expect(process.env[sovereign]).toBeUndefined()
  })
})
