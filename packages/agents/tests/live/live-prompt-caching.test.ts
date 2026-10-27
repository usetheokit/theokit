/**
 * LIVE proof — an agent on an Anthropic-family model reuses its system prompt from the provider
 * cache, so turn 2 is billed at the cache rate (B-412). Run with a provider key in the environment:
 *
 *   THEOKIT_LIVE_REQUIRED=1 pnpm --filter @theokit/agents exec vitest run \
 *     --config vitest.live.config.ts tests/live/live-prompt-caching.test.ts
 *
 * Why live: the Anthropic family caches only what the request marks with `cache_control`, and only
 * a real provider reports whether turn 2 read the cache. On `@theokit/sdk` 5.9.2 the system prompt
 * is sent as one unmarked string, so turn 2 reports no cache read even with a prompt far above the
 * model's 4096-token minimum.
 *
 * The model is fixed rather than read from `LIVE_MODEL`: the claim is about the Anthropic family
 * through OpenRouter, and the default live model caches implicitly, so it would pass on any SDK.
 *
 * Prints which key variable is present (never its value), the model id, both turns'
 * `tokensInput` and `cacheReadTokens`, and the upstream OpenRouter routed each turn to. A turn 2
 * served by another upstream than turn 1 cannot read turn 1's cache whatever the request carries,
 * so the turn-2 failure message names both (B-523).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { applyCapabilities } from '../../src/capability/capability.js'
import { AgentConfigCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import type { DelegationResult } from '../../src/bridge/delegation-types.js'
import { AgentRunner } from '../../src/loop/agent-runner.js'

import {
  describeUpstreams,
  recordRoutedProviders,
  upstreamLabel,
  upstreamOfTurn,
} from './routed-provider.js'

const MODEL = 'openrouter/anthropic/claude-haiku-4.5'
/**
 * Numbered rules in the generated prompt. Turn 1 measured 12 621 input tokens on 2026-10-17, about
 * three times the model's cache minimum.
 */
const RULE_COUNT = 400

/**
 * The OpenRouter key, and only it: the first-present key the other live files take could hand an
 * Anthropic or OpenAI key to OpenRouter and fail for a reason that has nothing to do with caching.
 */
const KEY_NAME = 'OPENROUTER_API_KEY'
const HAS_KEY = (process.env[KEY_NAME]?.trim() ?? '') !== ''
/** Under `THEOKIT_LIVE_REQUIRED=1` the test runs without the key and fails, instead of skipping. */
const REQUIRED = process.env.THEOKIT_LIVE_REQUIRED === '1'
/** Anthropic's documented minimum cacheable prompt for Claude Haiku 4.5, in tokens. */
const CACHE_MINIMUM_TOKENS = 4096

function apiKey(): string {
  const value = process.env[KEY_NAME]?.trim()
  if (value === undefined || value === '') throw new Error(`${KEY_NAME} is not set`)
  return value
}

function usageLine(turn: string, r: DelegationResult): string {
  return (
    `[live] ${turn}: tokensInput=${r.tokensInput ?? 'undefined'} ` +
    `cacheReadTokens=${r.cacheReadTokens ?? 'undefined'} ` +
    `cacheWriteTokens=${r.cacheWriteTokens ?? 'undefined'}`
  )
}

/** A system prompt long enough to be cacheable, identical on both turns. */
function longSystemPrompt(): string {
  const rules = Array.from(
    { length: RULE_COUNT },
    (_, i) =>
      `Rule ${i + 1}: when a request mentions item ${i + 1}, answer with its catalogue code ` +
      `CODE-${String(i + 1).padStart(4, '0')} and nothing about any other item.`,
  )
  return ['You are a catalogue assistant. Answer in one short sentence.', ...rules].join('\n')
}

const workDirs: string[] = []
/**
 * Installed before the runner is built: the SDK binds the global `fetch` when each `run()` builds
 * its client (`src/loop/agent-runner.ts:358`), so both turns go through the recorder.
 */
const record = recordRoutedProviders(globalThis)

afterAll(() => {
  record.restore()
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!HAS_KEY && !REQUIRED)('LIVE — prompt caching on an Anthropic-family model', () => {
  it('turn 2 reports cacheReadTokens > 0 on an Anthropic-family model through OpenRouter', async () => {
    console.log(`[live] provider key present: ${HAS_KEY ? KEY_NAME : '(none)'}`)
    console.log(`[live] model: ${MODEL}`)

    const dir = mkdtempSync(join(tmpdir(), 'live-prompt-caching-'))
    workDirs.push(dir)

    const compiled = applyCapabilities([
      new ModelCapability(MODEL),
      new AgentConfigCapability({ systemPrompt: longSystemPrompt() }),
    ])
    // One round per run, so each turn's usage is exactly one request's.
    const runner = AgentRunner.fromSpec({ compiled, name: 'catalogue', maxIterations: 1 }).build()
    const opts = {
      apiKey: apiKey(),
      sessionId: `live-prompt-caching-${crypto.randomUUID()}`,
      cwd: dir,
      baseDir: dir,
    }

    const turn1Start = record.providers.length
    const turn1 = await runner.run('What is the catalogue code of item 7?', opts)
    const turn1Upstream = upstreamOfTurn(record.providers, turn1Start, record.providers.length)
    console.log(usageLine('turn 1', turn1))
    console.log(`[live] turn 1: upstream=${upstreamLabel(turn1Upstream)}`)
    const turn2Start = record.providers.length
    const turn2 = await runner.run('And the catalogue code of item 12?', opts)
    const turn2Upstream = upstreamOfTurn(record.providers, turn2Start, record.providers.length)
    console.log(usageLine('turn 2', turn2))
    console.log(`[live] turn 2: upstream=${upstreamLabel(turn2Upstream)}`)

    // The prefix is long enough to cache, so a zero read below is the missing directive, not a
    // prompt under the minimum. Since @theokit/sdk 5.11.0 `tokensInput` is the uncached portion
    // only, so the whole prompt is that plus what the turn read from and wrote to the cache.
    const turn1Prompt =
      (turn1.tokensInput ?? 0) + (turn1.cacheReadTokens ?? 0) + (turn1.cacheWriteTokens ?? 0)
    expect(turn1Prompt).toBeGreaterThan(CACHE_MINIMUM_TOKENS)
    // A different upstream on each turn is a routing miss, not a missing cache directive.
    expect(turn2.cacheReadTokens, describeUpstreams(turn1Upstream, turn2Upstream)).toBeGreaterThan(
      0,
    )
  }, 120_000)
})
