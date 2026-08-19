import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * T2.3 — Anti-stack lint gate (FAANG-precise).
 *
 * The locked stack assumption (memory: project-stack-deps) says TheoKit's
 * default scaffold ALWAYS authors through `@theokit/agents`, never a raw
 * provider SDK (OpenAI/Anthropic/etc).
 *
 * M3 (clean break): the scaffold agent file is `agents/chat.ts` (not the removed
 * `server/routes/chat.ts`). The authoring surface has moved twice since —
 * `defineAgent` went internal in M31, and M57 replaced the free `agent()` with
 * `AgentBuilder.create()`, which is what the template writes today and what
 * compiles to the SDK at mount time.
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

// The file that is actually shipped to the user — the `create-theokit` template.
const FILES_TO_SCAN = ['packages/create-theokit/templates/default/agents/chat.ts'] as const

describe('scaffold anti-stack lint — no raw OpenAI in default agents/chat.ts (M3)', () => {
  it('declares exactly 1 file to scan (defends against missing file in array)', () => {
    expect(FILES_TO_SCAN.length).toBe(1)
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

    it(`${relativePath} authors through @theokit/agents, not a provider SDK`, () => {
      const content = readFileSync(absPath, 'utf-8')
      // The authoring surface is `AgentBuilder.create()…build()` (M57 renamed the free `agent()`
      // it replaced) composing `tool()…build()` capabilities — the compile-to-SDK bridge. The
      // legacy `defineAgent` / `defineAgentTool` still satisfy the gate for any not-yet-migrated
      // file. Any of these proves the locked stack.
      const authoredWithTheokit =
        /AgentBuilder\.create\(\)|\btool\(|defineAgent|defineAgentTool/.test(content)
      expect(authoredWithTheokit).toBe(true)
    })
  }
})
