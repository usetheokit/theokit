/** B-711: a secret named by a reference is resolved at start and its value is masked. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

import { afterAll, describe, expect, it } from 'vitest'

import { startTheoClaw } from '../src/composition.js'
import { builtinSecretStores, resolveSecretRefs, type SecretStore } from '@theokit/agents/auth'
import { capturingStream, fakeBuilders, noAgent, TELEGRAM_AND_LINE } from './composition-fixtures.js'

const TOOL_CWD = mkdtempSync(join(tmpdir(), 'theoclaw-refs-'))
afterAll(() => rmSync(TOOL_CWD, { recursive: true, force: true }))
const VALUE = 'resolved-broker-value-7781'
const stand = (kind: string, prefix: string, value: string): SecretStore => ({ kind, matches: (r) => r.startsWith(prefix), read: async () => value })

describe('secret references', () => {
  it('resolves env, file, 1Password and Vault references', async () => {
    const out = await resolveSecretRefs(
      { A: 'secretref:env:B', B: 'b-val', D: 'op://v/i/f', P: 'plain' },
      [...builtinSecretStores.filter((store) => store.kind === 'env'), stand('op', 'op://', 'op-val')],
    )
    expect(out.env).toMatchObject({ A: 'b-val', D: 'op-val', P: 'plain' })
    expect(out.refs).toEqual({ A: 'env', D: 'op' })
  })

  it('names the variable, never the value, when a store fails', async () => {
    const failing: SecretStore = { kind: 'op', matches: (r) => r.startsWith('op://'), read: async () => { throw new Error('boom') } }
    await expect(resolveSecretRefs({ K: 'op://v/i/f' }, [failing])).rejects.toThrow(/^K: .*\(op\)/)
  })

  it('masks a resolved value in the process output', async () => {
    const capture = capturingStream()
    const signals = new EventEmitter()
    const { builders } = fakeBuilders()
    const app = await startTheoClaw({
      cwd: TOOL_CWD,
      env: { ...TELEGRAM_AND_LINE, OPENROUTER_API_KEY: 'op://vault/item/key', THEOCLAW_CUSTOM: 'secretref:env:OTHER', OTHER: 'x' },
      secretStores: [stand('op', 'op://', VALUE)],
      agentFactory: noAgent,
      builders,
      signals,
      exit: () => undefined,
      streams: [capture],
    })
    try {
      await app.loop.ready
      capture.write(`leak ${VALUE} done\n`)
      expect(capture.text()).toContain('leak ')
      expect(capture.text()).not.toContain(VALUE)
    } finally {
      await app.loop.stopAll()
      await app.close()
    }
  })
})
