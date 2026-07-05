/**
 * M4 (theokit-ai-first) — the invariant guard (ADR 0038 enforcement teeth).
 *
 * The cohesive harness is an ADAPTER over `@theokit/sdk`, never a parallel runtime. This guard
 * reads the harness source and asserts, mechanically, that it:
 *   1. calls NO LLM provider API (G2 / sdk-runtime.md — the grep the rule mandates),
 *   2. issues NO `fetch(` of its own (all model I/O goes through the SDK),
 *   3. reuses the SDK runtime seam (`createSdkAgentStream`) and pauses via the SDK's OWN async
 *      `pre_tool_call` hook — it does NOT reimplement a tool-calling loop.
 *
 * A regression here means someone started growing a second runtime inside the harness — exactly
 * what ADR 0038 forbids. Fail loud.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// The root vitest runs from the repo root.
const ROOT = process.cwd()

/** The files that make the shipped decorators functional — the "harness". */
const HARNESS_FILES = [
  'packages/agents/src/bridge/hitl-plugin.ts',
  'packages/agents/src/bridge/agent-endpoint.ts',
  'packages/agents/src/bridge/ui-message-stream-translator.ts',
  'packages/theo/src/server/agent/mount-agent.ts',
  'packages/theo/src/server/agent/approve-agent.ts',
  'packages/theo/src/server/agent/approval-registry.ts',
]

/** LLM provider API hosts — a match means the harness bypassed the SDK to call a model directly. */
const LLM_API_HOSTS =
  /openrouter\.ai|api\.openai\.com|api\.anthropic\.com|api\.ollama|localhost:11434/

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('harness invariant guard — no parallel runtime (M4 / ADR 0038)', () => {
  it('test_harness_calls_no_llm_provider_api', () => {
    for (const file of HARNESS_FILES) {
      expect(LLM_API_HOSTS.test(read(file)), `${file} must not reference an LLM provider API`).toBe(
        false,
      )
    }
  })

  it('test_harness_issues_no_fetch_of_its_own', () => {
    for (const file of HARNESS_FILES) {
      // The harness never fetches — model I/O is the SDK's job. (`fetch(` as a call, not a substring.)
      expect(/\bfetch\s*\(/.test(read(file)), `${file} must not call fetch()`).toBe(false)
    }
  })

  it('test_harness_reuses_the_sdk_runtime_seam', () => {
    // The sole runtime entry-point is the SDK adapter; the endpoint imports it, never a bespoke loop.
    const endpoint = read('packages/agents/src/bridge/agent-endpoint.ts')
    expect(endpoint).toContain('createSdkAgentStream')
  })

  it('test_hitl_pause_is_the_sdk_pre_tool_call_hook_not_a_new_loop', () => {
    // The pause is the SDK's OWN awaited veto seam — the plugin registers a `pre_tool_call` handler
    // and returns a Promise the SDK loop awaits. No while/for tool-dispatch loop lives here.
    const plugin = read('packages/agents/src/bridge/hitl-plugin.ts')
    expect(plugin).toContain('pre_tool_call')
    // A reimplemented runtime would iterate tool calls; the plugin must not.
    expect(/while\s*\(/.test(plugin), 'hitl-plugin must not run its own loop').toBe(false)
  })
})
