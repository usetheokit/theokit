import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertBootstrapped,
  BootstrapNotRunError,
  BootstrapStepError,
  defineAppBootstrap,
  projectEnvStep,
} from '../../src/config-entry.js'

const ctx = (env: NodeJS.ProcessEnv = {}, cwd = '/tmp') => ({ env, cwd, home: '/home/x' })

describe('app bootstrap', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

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
    expect(b.run(ctx())).toBe(first)
    expect(await first).toEqual({ ran: ['a', 'b'] })
    await b.run(ctx())
    expect(calls).toEqual(['a', 'b'])
    expect(b.done).toBe(true)
  })

  it('a step that calls run() again gets the same promise and runs once', async () => {
    let calls = 0
    let inner: Promise<unknown> | undefined
    const b = defineAppBootstrap([
      {
        name: 'a',
        run: () => {
          calls += 1
          inner = b.run(ctx())
        },
      },
      {
        name: 'b',
        run: () => {
          calls += 10
        },
      },
    ])
    const outer = b.run(ctx())
    await outer
    expect(inner).toBe(outer)
    expect(calls).toBe(11)
  })

  it('a failing step throws BootstrapStepError naming the step and skips the rest', async () => {
    const boom = new Error('boom')
    let later = false
    const b = defineAppBootstrap([
      {
        name: 'bad',
        run: () => {
          throw boom
        },
      },
      {
        name: 'later',
        run: () => {
          later = true
        },
      },
    ])
    const err = await b.run(ctx()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BootstrapStepError)
    expect((err as BootstrapStepError).code).toBe('bootstrap_step_failed')
    expect((err as BootstrapStepError).message).toContain('bad')
    expect((err as BootstrapStepError).cause).toBe(boom)
    expect(later).toBe(false)
    expect(b.done).toBe(false)
  })

  it('duplicate step names throw at definition', () => {
    const s = { name: 'x', run: () => undefined }
    expect(() => defineAppBootstrap([s, s])).toThrow(/duplicate step name "x"/)
  })

  it('assertBootstrapped throws BootstrapNotRunError naming the caller before run and passes after', async () => {
    const b = defineAppBootstrap([])
    expect(() => assertBootstrapped(b, 'openStore')).toThrow(BootstrapNotRunError)
    expect(() => assertBootstrapped(b, 'openStore')).toThrow(/openStore/)
    await b.run(ctx())
    expect(() => assertBootstrapped(b, 'openStore')).not.toThrow()
  })

  it('projectEnvStep loads .env and refuses a sovereign key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-'))
    dirs.push(dir)
    const sovereign = SOVEREIGN_ENV_KEYS[0]
    writeFileSync(join(dir, '.env'), `APP_VALUE=1\n${sovereign}=/evil\n`)
    const env: NodeJS.ProcessEnv = {}
    await defineAppBootstrap([projectEnvStep]).run(ctx(env, dir))
    expect(env.APP_VALUE).toBe('1')
    expect(env[sovereign]).toBeUndefined()
  })
})
