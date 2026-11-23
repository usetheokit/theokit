import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertBootstrapped,
  BootstrapNotRunError,
  type BootstrapContext,
  BootstrapStepError,
  defineAppBootstrap,
  projectEnvStep,
  projectEnvStepWith,
  SdkHomeConflictError,
  sdkHomeStep,
  secretRefsStep,
} from '../../src/config-entry.js'

const ctx = (env: NodeJS.ProcessEnv = {}, cwd = '/tmp'): BootstrapContext => ({
  env,
  cwd,
  home: '/home/x',
})

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

  describe('project .env declarations', () => {
    async function load(text: string, env: NodeJS.ProcessEnv = {}, protectedKeys: string[] = []) {
      const dir = mkdtempSync(join(tmpdir(), 'bootstrap-'))
      dirs.push(dir)
      writeFileSync(join(dir, '.env'), text)
      const c = ctx(env, dir)
      await defineAppBootstrap([projectEnvStepWith({ protectedKeys })]).run(c)
      return { env, record: c.projectEnv! }
    }

    it('loads mixed-case identifiers, with leading space and an export prefix', async () => {
      const { record } = await load('  Mixed_Case1=a\n  export  Other_2=b\n_x=c\n')
      expect([...record.loaded].sort((a, b) => a.localeCompare(b))).toEqual([
        '_x',
        'Mixed_Case1',
        'Other_2',
      ])
    })

    it('loads a declaration below a line with no equals sign or no name, whatever the Node', async () => {
      // On Node 22.12, the floor in .nvmrc, util.parseEnv drops every declaration after a line with
      // no `=`: handing it the raw file loaded nothing here, while Node 22.23 loaded GOOD.
      const { env, record } = await load('# a comment\n\n=NO_NAME\nNO_EQUALS_SIGN\nGOOD=y\n')
      expect([...record.loaded]).toEqual(['GOOD'])
      expect(env.GOOD).toBe('y')
    })

    it('reads a CRLF multiline quoted value as Node reads it, and export with several spaces', async () => {
      const { env, record } = await load('export   A="one\r\ntwo"\r\nB=2\r\n')
      // Node's own parser folds CRLF in a quoted value to LF; the scan must not change that either way.
      expect(env.A).toBe(parseEnv('A="one\r\ntwo"').A)
      expect([...record.loaded].sort((a, b) => a.localeCompare(b))).toEqual(['A', 'B'])
    })

    it('ignores names that are not identifiers', async () => {
      const { env, record } = await load('BAD-NAME=x\n1BAD=y\nBAD.DOT=z\nGOOD=1\n')
      expect(record.loaded).toEqual(['GOOD'])
      expect(env['BAD-NAME']).toBeUndefined()
      expect(env['1BAD']).toBeUndefined()
      expect(env['BAD.DOT']).toBeUndefined()
    })

    it('skips comments and reads CRLF files', async () => {
      const { record } = await load('# C=3\r\nA=1\r\nB=2\r\n')
      expect([...record.loaded].sort((a, b) => a.localeCompare(b))).toEqual(['A', 'B'])
    })

    it('does not read a declaration from inside a multiline quoted value', async () => {
      const { env, record } = await load('A="first\nINSIDE=no\nlast"\nB=2\n')
      expect([...record.loaded].sort((a, b) => a.localeCompare(b))).toEqual(['A', 'B'])
      expect(env.INSIDE).toBeUndefined()
    })

    it('resumes after a value closed by a lone quote line', async () => {
      const { record } = await load('A="first\nmiddle\n"\nB=2\n')
      expect([...record.loaded].sort((a, b) => a.localeCompare(b))).toEqual(['A', 'B'])
    })

    it('resumes after a backtick multiline value', async () => {
      const { record } = await load('A=`first\nINSIDE=no\nlast`\nB=2\n')
      expect(record.loaded).not.toContain('INSIDE')
      expect(record.loaded).toContain('B')
    })

    it('reads the declaration after a value that opens and closes on one line', async () => {
      const { record } = await load('A="one line"\nB=2\n')
      expect([...record.loaded].sort((a, b) => a.localeCompare(b))).toEqual(['A', 'B'])
    })

    it('stops at an unterminated quote: later lines are not declarations', async () => {
      const { env, record } = await load('GOOD=1\nOPEN="never closed\nHIDDEN=5\n')
      expect(record.loaded).toEqual(['GOOD'])
      expect(env.OPEN).toBeUndefined()
      expect(env.HIDDEN).toBeUndefined()
    })

    it('keeps a shell value and does not report it loaded', async () => {
      const { env, record } = await load('A=file\nB=file\n', { A: 'shell' })
      expect(env.A).toBe('shell')
      expect(record.loaded).toEqual(['B'])
    })

    it('reports a protected key refused while still scanning strictly', async () => {
      const { env, record } = await load('P=1\nBAD-NAME=x\nOK=2\n', {}, ['P'])
      expect(record.refused).toEqual(['P'])
      expect(record.loaded).toEqual(['OK'])
      expect(env.P).toBeUndefined()
    })
  })

  it('projectEnvStepWith leaves a protected key unset and reports it refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-'))
    dirs.push(dir)
    writeFileSync(join(dir, '.env'), 'APP_KEY=x\nOTHER=2\nALREADY=file\n')
    const env: NodeJS.ProcessEnv = { ALREADY: 'shell' }
    const c = ctx(env, dir)
    await defineAppBootstrap([projectEnvStepWith({ protectedKeys: ['APP_KEY'] })]).run(c)
    expect(env.APP_KEY).toBeUndefined()
    expect(env.ALREADY).toBe('shell')
    expect(c.projectEnv).toEqual({
      file: join(dir, '.env'),
      loaded: ['OTHER'],
      refused: ['APP_KEY'],
    })
  })

  it('records an empty result when there is no .env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-'))
    dirs.push(dir)
    const c = ctx({}, dir)
    await defineAppBootstrap([projectEnvStep]).run(c)
    expect(c.projectEnv).toEqual({ file: join(dir, '.env'), loaded: [], refused: [] })
  })
})

describe('sdkHomeStep and secretRefsStep', () => {
  const home = '/home/x'
  it('points both variables inside <home>/<dirName>', async () => {
    const env: NodeJS.ProcessEnv = {}
    await defineAppBootstrap([sdkHomeStep({ dirName: '.myapp' })]).run({ env, cwd: '/tmp', home })
    expect(env.THEOKIT_HOME).toBe('/home/x/.myapp')
    expect(env.THEOKIT_AUTH_HOME).toBe('/home/x/.myapp')
  })

  it('profile form resolves under the SDK profiles root', async () => {
    const env: NodeJS.ProcessEnv = {}
    await defineAppBootstrap([sdkHomeStep({ profile: 'work' })]).run({ env, cwd: '/tmp', home })
    expect(env.THEOKIT_HOME).toBe('/home/x/.theokit/profiles/work')
    expect(env.THEOKIT_AUTH_HOME).toBe(env.THEOKIT_HOME)
  })

  it('refuse fails with a typed error naming the variable and writes nothing', async () => {
    const env: NodeJS.ProcessEnv = { THEOKIT_AUTH_HOME: '/secret/place' }
    const run = defineAppBootstrap([sdkHomeStep({ dirName: '.myapp', onConflict: 'refuse' })]).run({
      env,
      cwd: '/tmp',
      home,
    })
    const err = await run.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BootstrapStepError)
    const cause = (err as BootstrapStepError).cause
    expect(cause).toBeInstanceOf(SdkHomeConflictError)
    expect((cause as SdkHomeConflictError).variable).toBe('THEOKIT_AUTH_HOME')
    expect((cause as Error).message).not.toContain('/secret/place')
    expect(env.THEOKIT_HOME).toBeUndefined()
  })

  it('env-wins leaves set values and fills the other', async () => {
    const env: NodeJS.ProcessEnv = { THEOKIT_HOME: '/elsewhere' }
    await defineAppBootstrap([sdkHomeStep({ dirName: '.myapp', onConflict: 'env-wins' })]).run({
      env,
      cwd: '/tmp',
      home,
    })
    expect(env.THEOKIT_HOME).toBe('/elsewhere')
    expect(env.THEOKIT_AUTH_HOME).toBe('/home/x/.myapp')
  })

  it('a later step sees the variables set', async () => {
    const env: NodeJS.ProcessEnv = {}
    let seen: string | undefined
    await defineAppBootstrap([
      sdkHomeStep({ dirName: '.myapp' }),
      {
        name: 'after',
        run: (c) => {
          seen = c.env.THEOKIT_HOME
        },
      },
    ]).run({ env, cwd: '/tmp', home })
    expect(seen).toBe('/home/x/.myapp')
  })

  it('secretRefsStep resolves env references', async () => {
    const env: NodeJS.ProcessEnv = { PLAIN: 'x', TOKEN: 'secretref:env:SOURCE', SOURCE: 'real' }
    await defineAppBootstrap([secretRefsStep()]).run({ env, cwd: '/tmp', home })
    expect(env.PLAIN).toBe('x')
    expect(env.TOKEN).toBe('real')
  })
})
