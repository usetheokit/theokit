import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { gate } from './gate.mjs'
import { redact, runCli, runScenario, secretValues, verdictFor } from './harness.mjs'
import { SCENARIOS } from './scenarios.mjs'

const dirs = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('gate', () => {
  const ship = (id, path = 'a.ts') => ({ id, status: 'shipped', check: { path } })
  const run = (over) =>
    gate({ ledger: [ship('OC-1')], baseLedger: [{ id: 'OC-1', status: 'open' }], changed: new Set(), lastChange: () => '2026-11-01T00:00:00Z', readResult: () => undefined, ...over })

  it('names a newly shipped item with no result', () => {
    expect(run({})).toEqual([{ id: 'OC-1', why: 'no results/OC-1.json' }])
  })
  it('passes with a works result dated after the last change', () => {
    expect(run({ readResult: () => ({ verdict: 'works', date: '2026-11-02T00:00:00Z' }) })).toEqual([])
  })
  it('fails when a named file changed after the result', () => {
    expect(run({ readResult: () => ({ verdict: 'works', date: '2026-10-01T00:00:00Z' }) })).toHaveLength(1)
  })
  it('refuses a result that is not works', () => {
    expect(run({ readResult: () => ({ verdict: 'partial', date: '2026-12-01T00:00:00Z' }) })).toHaveLength(1)
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
    expect(new Set(SCENARIOS.map((s) => s.surface))).toEqual(new Set(['control', 'webchat', 'cli', 'matrix', 'mattermost']))
  })
  it('judges a reply', () => {
    expect(verdictFor({}, { text: 'pong', matched: true, failed: false })).toBe('works')
    expect(verdictFor({}, { text: 'x', matched: false, failed: false })).toBe('partial')
    expect(verdictFor({}, { text: '', matched: false, failed: true })).toBe('broken')
  })
  it('redacts every configured secret', () => {
    const secrets = secretValues({ OPENROUTER_API_KEY: 'sk-secret-value-1', HOME: '/x' }, ['tok-abcdefgh'])
    expect(JSON.stringify(redact({ a: 'x sk-secret-value-1 tok-abcdefgh' }, secrets))).not.toMatch(/sk-secret|tok-abcdefgh/)
  })
  it('writes a result through a transport and keeps secrets out of it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-test-'))
    dirs.push(dir)
    const env = { PATH: process.env.PATH, THEOCLAW_PARITY_MODEL: 'm', OPENROUTER_API_KEY: 'sk-secret-value-1' }
    const makeTransport = () => ({
      async send() {},
      awaitReply: async (match) => ({ text: 'pong sk-secret-value-1', matched: match.test('pong'), failed: false, raw: [] }),
    })
    const result = await runScenario(SCENARIOS[0], { env, makeTransport, resultsDir: dir })
    const text = readFileSync(join(dir, 'OC-22.json'), 'utf8')
    expect(result.verdict).toBe('works')
    expect(text).not.toContain('sk-secret-value-1')
    expect(JSON.parse(text)).toMatchObject({ id: 'OC-22', model: 'm' })
  })
  it('skips and names a scenario with no model', async () => {
    const lines = []
    const code = await runCli(['--all'], { env: {}, out: { log: (l) => lines.push(l), error: (l) => lines.push(l) } })
    expect(code).toBe(0)
    expect(lines.filter((l) => l.startsWith('skip OC-22'))).toHaveLength(1)
  })
})
