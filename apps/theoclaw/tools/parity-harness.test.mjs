import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  gate,
  inputsDigest,
  LEDGER,
  redact,
  RESULTS_DIR,
  runGate,
  runScenario,
  telegramTransport,
  writeResult,
} from './parity-harness.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })))

const git = (root, ...args) =>
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- test repo set-up
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: root,
    stdio: 'pipe',
  })

function repo(entry) {
  const root = mkdtempSync(join(tmpdir(), 'parity-'))
  roots.push(root)
  mkdirSync(join(root, 'apps/theoclaw/parity'), { recursive: true })
  mkdirSync(join(root, 'apps/theoclaw/tests'), { recursive: true })
  writeFileSync(join(root, 'apps/theoclaw/tests/a.test.ts'), 'a')
  writeFileSync(join(root, LEDGER), `${JSON.stringify([entry], null, 2)}\n`)
  git(root, 'init', '-q')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'x', '--date', '2020-01-01T00:00:00Z')
  return root
}
const entry = {
  id: 'OC-2',
  status: 'shipped',
  check: { path: 'apps/theoclaw/tests/a.test.ts', test: 't' },
}

describe('parity gate', () => {
  const ok = (digest = 'd') => ({ id: 'OC-2', verdict: 'works', real: true, commit: 'abc', inputs_digest: digest })

  it('names a shipped item without a result', () => {
    expect(gate([entry], () => null, () => 'd')).toEqual([{ id: 'OC-2', detail: 'no result file' }])
  })
  it('passes a matching digest; fails a stale digest, a failing verdict or an unknown commit', () => {
    expect(gate([entry], () => ok(), () => 'd')).toEqual([])
    expect(gate([entry], () => ok('old'), () => 'd')).toHaveLength(1)
    expect(gate([entry], () => ({ ...ok(), verdict: 'fails' }), () => 'd')).toHaveLength(1)
    expect(gate([entry], () => ok(), () => 'd', () => false)).toHaveLength(1)
  })
  it('ignores items that are not shipped', () => {
    expect(gate([{ id: 'OC-1', status: 'open' }], () => null, () => null)).toEqual([])
  })
  it('digest ignores status/note but changes with a named file', () => {
    const root = repo({ ...entry, files: ['apps/theoclaw/tests/b.ts'] })
    writeFileSync(join(root, 'apps/theoclaw/tests/b.ts'), 'b')
    const e = { ...entry, files: ['apps/theoclaw/tests/b.ts'] }
    const before = inputsDigest(e, root)
    expect(inputsDigest({ ...e, status: 'open', note: 'x', verified_on: '2026-01-01' }, root)).toBe(before)
    writeFileSync(join(root, 'apps/theoclaw/tests/b.ts'), 'changed')
    expect(inputsDigest(e, root)).not.toBe(before)
  })
  it('end to end: missing, passing, then stale after a named file changes', () => {
    const root = repo(entry)
    const lines = []
    expect(runGate({ root, write: (l) => lines.push(l) })).toBe(1)
    expect(lines[0]).toContain('OC-2')
    mkdirSync(join(root, RESULTS_DIR), { recursive: true })
    const commit = git(root, 'rev-parse', 'HEAD').toString().trim()
    writeFileSync(
      join(root, RESULTS_DIR, 'OC-2.json'),
      JSON.stringify({ id: 'OC-2', verdict: 'works', real: true, commit, inputs_digest: inputsDigest(entry, root) }),
    )
    expect(runGate({ root, write: () => {} })).toBe(0)
    writeFileSync(join(root, 'apps/theoclaw/tests/a.test.ts'), 'changed')
    expect(runGate({ root, write: () => {} })).toBe(1)
  })
})

describe('parity run', () => {
  const secret = 'tok:SECRET-123'
  const env = {
    PARITY_TELEGRAM_DRIVER_TOKEN: secret,
    PARITY_TELEGRAM_CHAT_ID: '5',
    PARITY_TELEGRAM_BOT_ID: '9',
  }

  it('redacts secrets', () => {
    expect(redact(`a ${secret} b`, [secret])).toBe('a [redacted] b')
  })

  it('sends a Telegram DM and records the reply without the credential', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      const method = url.split('/').pop()
      const result =
        method === 'sendMessage'
          ? { message_id: 1 }
          : [
              {
                update_id: 7,
                message: {
                  message_id: 2,
                  from: { id: 9 },
                  chat: { id: 5 },
                  text: `PARITY-OK ${secret}`,
                },
              },
            ]
      return { ok: true, json: async () => ({ ok: true, result }) }
    }
    const root = repo(entry)
    const record = await runScenario('OC-2', {
      env,
      root,
      transports: { telegram: ({ env: e }) => telegramTransport({ env: e, fetchImpl, pollMs: 1 }) },
    }).catch((e) => e)
    // apps/theoclaw/package.json is absent in the temp repo; use the real root for versions instead.
    expect(record).toBeInstanceOf(Error)
    const real = await runScenario('OC-2', {
      env,
      transports: { telegram: ({ env: e }) => telegramTransport({ env: e, fetchImpl, pollMs: 1 }) },
    })
    expect(real.verdict).toBe('works')
    expect(real.received).toContain('PARITY-OK')
    expect(JSON.stringify(real)).not.toContain(secret)
    expect(calls.length).toBeGreaterThan(1)
    const out = mkdtempSync(join(tmpdir(), 'parity-out-'))
    roots.push(out)
    writeResult(real, out)
    expect(readFileSync(join(out, RESULTS_DIR, 'OC-2.json'), 'utf8')).not.toContain(secret)
  })
})
