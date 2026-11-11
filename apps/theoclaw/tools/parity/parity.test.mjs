import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { gate } from './gate.mjs'
import { missingForOpenClaw, runOpenClaw } from './openclaw.mjs'
import { redact, runCli, runScenario, secretValues, verdictFor } from './harness.mjs'
import { SCENARIOS } from './scenarios.mjs'

const dirs = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('gate', () => {
  const ship = (id, path = 'a.ts') => ({ id, status: 'shipped', check: { path } })
  const run = (over) =>
    gate({
      ledger: [ship('OC-1')],
      baseLedger: [{ id: 'OC-1', status: 'open' }],
      changed: new Set(),
      lastChange: () => '2026-11-01T00:00:00Z',
      readResult: () => undefined,
      ...over,
    })

  it('names a newly shipped item with no result', () => {
    expect(run({})).toEqual([{ id: 'OC-1', why: 'no results/OC-1.json' }])
  })
  it('passes with a works result dated after the last change', () => {
    expect(run({ readResult: () => ({ verdict: 'works', date: '2026-11-02T00:00:00Z' }) })).toEqual(
      [],
    )
  })
  it('fails when a named file changed after the result', () => {
    expect(
      run({ readResult: () => ({ verdict: 'works', date: '2026-10-01T00:00:00Z' }) }),
    ).toHaveLength(1)
  })
  it('refuses a result that is not works', () => {
    expect(
      run({ readResult: () => ({ verdict: 'partial', date: '2026-12-01T00:00:00Z' }) }),
    ).toHaveLength(1)
  })
  it('skips shipped items the change does not touch, and checks them when a named file changes', () => {
    const base = [ship('OC-1')]
    expect(run({ baseLedger: base })).toEqual([])
    expect(run({ baseLedger: base, changed: new Set(['a.ts']) })).toHaveLength(1)
  })
  it('checks everything without a base', () => {
    expect(run({ baseLedger: undefined })).toHaveLength(1)
  })
})

describe('harness', () => {
  it('ships one scenario per surface', () => {
    expect(new Set(SCENARIOS.map((s) => s.surface))).toEqual(new Set(['control', 'webchat', 'cli']))
  })
  it('judges a reply', () => {
    expect(verdictFor({}, { text: 'pong', matched: true, failed: false })).toBe('works')
    expect(verdictFor({}, { text: 'x', matched: false, failed: false })).toBe('partial')
    expect(verdictFor({}, { text: '', matched: false, failed: true })).toBe('broken')
  })
  it('redacts every configured secret', () => {
    const secrets = secretValues({ OPENROUTER_API_KEY: 'sk-secret-value-1', HOME: '/x' }, [
      'tok-abcdefgh',
    ])
    expect(JSON.stringify(redact({ a: 'x sk-secret-value-1 tok-abcdefgh' }, secrets))).not.toMatch(
      /sk-secret|tok-abcdefgh/,
    )
  })
  it('writes a result through a transport and keeps secrets out of it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-test-'))
    dirs.push(dir)
    const env = {
      PATH: process.env.PATH,
      THEOCLAW_PARITY_MODEL: 'm',
      OPENROUTER_API_KEY: 'sk-secret-value-1',
    }
    const makeTransport = () => ({
      async send() {},
      awaitReply: async (match) => ({
        text: 'pong sk-secret-value-1',
        matched: match.test('pong'),
        failed: false,
        raw: [],
      }),
    })
    const result = await runScenario(SCENARIOS[0], { env, makeTransport, resultsDir: dir })
    const text = readFileSync(join(dir, 'OC-22.json'), 'utf8')
    expect(result.verdict).toBe('works')
    expect(text).not.toContain('sk-secret-value-1')
    expect(JSON.parse(text)).toMatchObject({ id: 'OC-22', model: 'm' })
  })
  it('skips and names a scenario with no model', async () => {
    const lines = []
    const code = await runCli(['--all'], {
      env: {},
      out: { log: (l) => lines.push(l), error: (l) => lines.push(l) },
    })
    expect(code).toBe(0)
    expect(lines.filter((l) => l.startsWith('skip OC-22'))).toHaveLength(1)
  })
})

describe('openclaw side', () => {
  const MODEL = 'openai-chatgpt/gpt-x'
  const login = (dir) => {
    const file = join(dir, 'auth.json')
    writeFileSync(file, '{"token":"tok-secret-value-1"}')
    return file
  }
  const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-test-'))
    dirs.push(dir)
    return dir
  }
  const stubDeps = (log, text = 'pong') => ({
    freePort: async () => 4321,
    install: async (_dir, version) => (log.push(`install ${version}`), '/bin/openclaw'),
    startGateway: () => ({
      output: () => '',
      exited: () => false,
      stop: async () => {
        log.push('stop')
      },
    }),
    waitForPort: async () => {},
    run: async (_bin, args) => (log.push(args.join(' ')), { code: 0, output: text }),
  })

  it('names what is missing, for both products', () => {
    const missing = missingForOpenClaw(
      'both',
      { HOME: '/nonexistent', THEOCLAW_PARITY_MODEL: MODEL },
      () => false,
    )
    expect(missing).toHaveLength(2)
    expect(
      missingForOpenClaw('both', { HOME: '/x', THEOCLAW_PARITY_MODEL: 'other/model' }, () => true),
    ).toEqual([expect.stringContaining('openai-chatgpt/')])
    expect(missingForOpenClaw('openclaw', { HOME: '/x' }, () => true)).toEqual([
      'THEOCLAW_PARITY_MODEL is not set',
    ])
  })
  it('--side both exits non-zero before starting either product when the login is missing', async () => {
    const lines = []
    const run = async () => {
      throw new Error('must not start')
    }
    const env = { HOME: '/nonexistent-home', THEOCLAW_PARITY_MODEL: MODEL }
    const code = await runCli(['--id', 'OC-22', '--side', 'both'], {
      env,
      run,
      out: { log: (l) => lines.push(l), error: (l) => lines.push(l) },
    })
    expect(code).toBe(2)
    expect(lines.join('\n')).toMatch(/subscription login for OpenClaw/)
  })
  it('rejects an unknown side', async () => {
    const lines = []
    expect(
      await runCli(['--id', 'OC-22', '--side', 'x'], {
        env: {},
        out: { log: () => {}, error: (l) => lines.push(l) },
      }),
    ).toBe(2)
  })
  it('runs a /control turn through openclaw agent --message with the pinned version', async () => {
    const home = tmp()
    const authFile = login(home)
    const log = []
    const outcome = await runOpenClaw(SCENARIOS[0], {
      env: { PATH: '', THEOCLAW_PARITY_OPENCLAW_AUTH: authFile },
      home,
      model: MODEL,
      token: 't',
      deps: stubDeps(log),
      version: '1.2.3',
    })
    expect(outcome).toMatchObject({ version: '1.2.3', text: 'pong', failed: false })
    expect(log).toEqual([
      'install 1.2.3',
      'agent --message Reply with the single word: pong',
      'stop',
    ])
  })
  it('records an openclaw failure as a result, not a throw', async () => {
    const home = tmp()
    const authFile = login(home)
    const deps = {
      ...stubDeps([]),
      install: async () => {
        throw new Error('npm down')
      },
    }
    const outcome = await runOpenClaw(SCENARIOS[0], {
      env: { THEOCLAW_PARITY_OPENCLAW_AUTH: authFile },
      home,
      model: MODEL,
      token: 't',
      deps,
    })
    expect(outcome).toMatchObject({ failed: true, error: 'npm down' })
  })
  it('--side both writes both verdicts with reply, version and the same model; secrets stay out', async () => {
    const dir = tmp()
    const authFile = login(dir)
    const env = {
      PATH: process.env.PATH,
      HOME: dir,
      THEOCLAW_PARITY_MODEL: MODEL,
      THEOCLAW_PARITY_THEOKIT_AUTH: authFile,
      THEOCLAW_PARITY_OPENCLAW_AUTH: authFile,
    }
    const makeTransport = () => ({
      async send() {},
      awaitReply: async (match) => ({
        text: 'pong',
        matched: match.test('pong'),
        failed: false,
        raw: [],
      }),
    })
    const openclaw = async () => ({
      version: '9.9.9',
      text: 'pong tok-secret-value-1',
      failed: false,
    })
    const result = await runScenario(SCENARIOS[0], {
      env,
      makeTransport,
      resultsDir: dir,
      side: 'both',
      openclaw,
    })
    const written = JSON.parse(readFileSync(join(dir, 'OC-22.json'), 'utf8'))
    expect(written).toEqual(result)
    expect(written.theoclaw).toMatchObject({ verdict: 'works', reply: 'pong', model: MODEL })
    expect(written.openclaw).toMatchObject({ verdict: 'works', version: '9.9.9', model: MODEL })
    expect(written.verdict).toBe('works')
  })
  it('--side openclaw keeps the theoclaw half an earlier run wrote', async () => {
    const dir = tmp()
    writeFileSync(
      join(dir, 'OC-22.json'),
      JSON.stringify({ verdict: 'works', theoclaw: { verdict: 'works' } }),
    )
    const openclaw = async () => ({ version: '9.9.9', text: 'nope', failed: false })
    await runScenario(SCENARIOS[0], {
      env: { PATH: '', THEOCLAW_PARITY_MODEL: MODEL },
      resultsDir: dir,
      side: 'openclaw',
      openclaw,
    })
    const written = JSON.parse(readFileSync(join(dir, 'OC-22.json'), 'utf8'))
    expect(written).toMatchObject({
      verdict: 'works',
      theoclaw: { verdict: 'works' },
      openclaw: { verdict: 'partial' },
    })
  })
})
