import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * T2.3 — Anti-stack lint gate (FAANG-precise).
 *
 * The locked stack assumption (memory: project-stack-deps) says TheoKit's
 * default scaffold ALWAYS wires `@theokit/agents` / `defineAgent`, never a raw
 * provider SDK (OpenAI/Anthropic/etc).
 *
 * M3 (clean break): the scaffold agent file is now `agents/chat.ts` (not the
 * removed `server/routes/chat.ts`). The indirection changes from
 * `createConversationHistory|streamAgentRun` to `defineAgent|defineAgentTool`
 * — `defineAgent` compiles to the SDK at mount time (the new bridge).
 *
 * Precision: this gate checks for actual IMPORTS of the `openai` npm package
 * (or `@anthropic-ai/sdk`, etc), NOT casual mentions. The wire protocol IS
 * OpenAI Chat Completions (universal — implemented by OpenRouter, Groq,
 * Together, Mistral, etc); explaining that in docstrings is correct domain
 * documentation and must not trip the gate.
 *
 * Forbidden patterns (raw SDK imports):
 *   - `from 'openai'` / `from "openai"`
 *   - `require('openai')` / `require("openai")`
 *   - `import('openai')` / `import("openai")`
 *
 * Allowed patterns:
 *   - Comments mentioning "OpenAI Chat Completions" (the wire protocol)
 *   - Env var names like `OPENAI_API_KEY` (one of the resolution priorities)
 *   - String literals like `'openai'` as provider name (Strategy registry)
 */

const ROOT = resolve(__dirname, '../..')

const FILES_TO_SCAN = [
  'fixtures/template-default/agents/chat.ts',
  'packages/create-theokit/templates/default/agents/chat.ts',
] as const

describe('scaffold anti-stack lint — no raw OpenAI in default agents/chat.ts (M3)', () => {
  it('declares exactly 2 files to scan (defends against missing file in array)', () => {
    expect(FILES_TO_SCAN.length).toBe(2)
  })

  for (const relativePath of FILES_TO_SCAN) {
    const absPath = resolve(ROOT, relativePath)

    it(`${relativePath} exists`, () => {
      expect(existsSync(absPath)).toBe(true)
    })

    it(`${relativePath} does NOT import the raw 'openai' npm package`, () => {
      const content = readFileSync(absPath, 'utf-8')
      // Match: from 'openai', from "openai", require('openai'), require("openai"),
      // import('openai'), import("openai"). Allows comments + env var names +
      // provider-name string literals (which are domain reality).
      const rawSdkImport =
        /(?:from|require\(|import\()\s*['"]openai['"]/i.test(content) ||
        /from\s+['"]@anthropic-ai\/sdk['"]/i.test(content)
      expect(
        rawSdkImport,
        `${relativePath} must not import raw provider SDKs (locked stack: @theokit/agents via defineAgent)`,
      ).toBe(false)
    })

    it(`${relativePath} uses @theokit/agents (directly OR indirectly via agent()/tool() builders)`, () => {
      const content = readFileSync(absPath, 'utf-8')
      // M31 builder-only: the authoring surface is `agent()...build()` / `tool()...build()`
      // (the compile-to-SDK bridge). Legacy `defineAgent`/`defineAgentTool` still accepted for
      // any not-yet-migrated file. Any of these proves the locked stack.
      const indirectViaTheokit = /\bagent\(\)|\btool\(|defineAgent|defineAgentTool/.test(content)
      expect(indirectViaTheokit).toBe(true)
    })
  }
})
