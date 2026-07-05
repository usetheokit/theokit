/**
 * M5 (theokit-ai-first) — the terminal-harness invariant guard (ADR 0039 D2 enforcement teeth).
 *
 * The terminal harness is a RENDER SURFACE over the M4 harness — never a parallel runtime. This guard
 * reads the terminal source and asserts, mechanically, that it:
 *   1. calls NO LLM provider API (G2 / sdk-runtime.md),
 *   2. issues NO `fetch(` of its own,
 *   3. reuses the M4 harness (`streamAgentUIMessages`) and does not reimplement a tool-calling loop.
 *
 * A regression here means the terminal started growing its own runtime — exactly what ADR 0039 D2
 * forbids. Fail loud.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** The files that make up the M5 terminal harness. */
const TERMINAL_FILES = [
  'packages/theo/src/server/agent/render-terminal.ts',
  'packages/theo/src/server/agent/run-terminal-agent.ts',
  'packages/theo/src/cli/commands/agent.ts',
]

const LLM_API_HOSTS =
  /openrouter\.ai|api\.openai\.com|api\.anthropic\.com|api\.ollama|localhost:11434/

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('terminal-harness invariant guard — no parallel runtime (M5 / ADR 0039)', () => {
  it('test_terminal_calls_no_llm_provider_api', () => {
    for (const file of TERMINAL_FILES) {
      expect(LLM_API_HOSTS.test(read(file)), `${file} must not reference an LLM provider API`).toBe(
        false,
      )
    }
  })

  it('test_terminal_issues_no_fetch_of_its_own', () => {
    for (const file of TERMINAL_FILES) {
      expect(/\bfetch\s*\(/.test(read(file)), `${file} must not call fetch()`).toBe(false)
    }
  })

  it('test_terminal_reuses_the_m4_harness', () => {
    // The terminal runner streams via the M4 harness, never a bespoke loop.
    const runner = read('packages/theo/src/server/agent/run-terminal-agent.ts')
    expect(runner).toContain('streamAgentUIMessages')
    expect(runner).toContain('compileAgentModule')
    // No while/for tool-dispatch loop lives here — the SDK owns iteration.
    expect(/while\s*\(/.test(runner), 'run-terminal-agent must not run its own loop').toBe(false)
  })

  it('test_terminal_reuses_the_shared_approval_registry', () => {
    // Approval resolves the SAME in-process registry the web approve-route uses (M4) — not a new store.
    const runner = read('packages/theo/src/server/agent/run-terminal-agent.ts')
    expect(runner).toContain('getApprovalRegistry')
  })
})
