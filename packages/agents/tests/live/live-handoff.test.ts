/**
 * LIVE proof — a conversation hands off from one agent to another on a REAL provider (B-410). Run
 * with a provider key in the environment:
 *
 *   THEOKIT_LIVE_REQUIRED=1 pnpm --filter @theokit/agents exec vitest run \
 *     --config vitest.live.config.ts tests/live/live-handoff.test.ts
 *
 * Why live: the integration suite mocks the SDK stream and calls the transfer tool's handler itself,
 * so only a real run proves that a model reads `transfer_to_agent`, calls it with a roster name,
 * and that the next turn runs on the receiving agent. Billing's system prompt, and only billing's,
 * tells it to start every answer with `BILLING:`, so the text proves billing's compiled agent
 * produced the second turn, not only the conversation's label.
 *
 * Prints which key variable is present (never its value), the model id, every tool call the first
 * turn made, and the second turn's responder.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { applyCapabilities } from '../../src/capability/capability.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { createHandoffConversation } from '../../src/handoff/handoff-conversation.js'

import { resolveLiveModel } from '../../../../scripts/live-model.mjs'

import { redactThenCut } from './provider-text.js'
import { LIVE_KEY_NAMES } from './require-provider-key.js'

const MODEL = resolveLiveModel(process.env)
const PRESENT_KEYS = LIVE_KEY_NAMES.filter((n) => (process.env[n]?.trim() ?? '') !== '')
const HAS_KEY = PRESENT_KEYS.length > 0

function apiKey(): string {
  for (const n of LIVE_KEY_NAMES) {
    const v = process.env[n]?.trim()
    if (v !== undefined && v !== '') return v
  }
  throw new Error(`no provider key present: none of ${LIVE_KEY_NAMES.join(', ')} is set`)
}

function liveAgent(name: string, systemPrompt: string) {
  return { name, compiled: { ...applyCapabilities([new ModelCapability(MODEL)]), systemPrompt } }
}

const TRIAGE = liveAgent(
  'triage',
  'You are the triage desk. You never handle refunds yourself. For ANY request about a refund, ' +
    'call the transfer_to_agent tool with agent "billing" and a note summarising the request, ' +
    'then tell the user they are being transferred.',
)
const BILLING = liveAgent(
  'billing',
  'You are the billing desk and you handle refunds. Start every answer with the exact tag ' +
    '"BILLING:" followed by your reply.',
)

const workDirs: string[] = []

afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!HAS_KEY)('LIVE — a handoff between two agents on a real provider', () => {
  it('a real model hands the conversation to billing, which answers the next turn', async () => {
    console.log(`[live] provider key present: ${PRESENT_KEYS.join(', ')}`)
    console.log(`[live] model: ${MODEL}`)

    const dir = mkdtempSync(join(tmpdir(), 'live-handoff-'))
    workDirs.push(dir)
    const opts = { apiKey: apiKey(), cwd: dir, baseDir: dir }

    const conv = createHandoffConversation({ agents: [TRIAGE, BILLING], initial: 'triage' })

    const first = await conv.send('I bought headphones last week and I want a refund.', opts)
    for (const call of first.toolCalls) {
      console.log(
        `[live] tool call: ${call.name} ${redactThenCut(JSON.stringify(call.input ?? {}), 200)}`,
      )
    }
    const second = await conv.send('The order number is 4471. How long will it take?', opts)
    console.log(`[live] responder: ${second.responder}`)
    console.log(`[live] second answer: ${redactThenCut(second.response, 200)}`)

    expect(first.handoff?.to).toBe('billing')
    expect(second.responder).toBe('billing')
    expect(second.response).toContain('BILLING:')
  }, 120_000)
})
