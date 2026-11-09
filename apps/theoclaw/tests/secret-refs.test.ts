/** B-711: a secret named by a reference is resolved at start and its value is masked. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

import { afterAll, describe, expect, it } from 'vitest'

import { startTheoClaw } from '../src/composition.js'
import { resolveSecretRefs } from '../src/secret-refs.js'
import { capturingStream, fakeBuilders, noAgent, TELEGRAM_AND_LINE } from './composition-fixtures.js'

const TOOL_CWD = mkdtempSync(join(tmpdir(), 'theoclaw-refs-'))
afterAll(() => rmSync(TOOL_CWD, { recursive: true, force: true }))
const VALUE = 'resolved-broker-value-7781'

describe('secret references', () => {
  it('resolves env, file, 1Password and Vault references', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ data: { data: { key: 'vault-val' } } }))) as typeof fetch
    const out = await resolveSecretRefs(
      { A: 'secretref:env:B', B: 'b-val', C: 'secretref:file:/x', D: 'op://v/i/f', E: 'secretref:vault:secret/data/app#key', VAULT_ADDR: 'http://v', VAULT_TOKEN: 't', P: 'plain' },
      { readFile: () => 'file-val\n', broker: async () => 'op-val\n', fetchImpl },
    )
    expect(out.env).toMatchObject({ A: 'b-val', C: 'file-val', D: 'op-val', E: 'vault-val', P: 'plain' })
    expect(out.refs).toEqual({ A: 'env', C: 'file', D: 'op', E: 'vault' })
  })

  it('names the variable, never the value, when a store fails', async () => {
    await expect(resolveSecretRefs({ K: 'op://v/i/f' }, { broker: async () => { throw new Error('boom') } })).rejects.toThrow(/^K: .*\(op\)/)
  })

  it('masks a resolved value in the process output', async () => {
    const capture = capturingStream()
    const signals = new EventEmitter()
    const { builders } = fakeBuilders()
    const app = await startTheoClaw({
      cwd: TOOL_CWD,
      env: { ...TELEGRAM_AND_LINE, OPENROUTER_API_KEY: 'op://vault/item/key', THEOCLAW_CUSTOM: 'secretref:env:OTHER', OTHER: 'x' },
      secretStores: { broker: async () => VALUE },
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
