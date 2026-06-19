import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * T3.1 — Canonical chat.ts (item #4) — defineAgentTool + streamAgentRun.
 *
 * The default scaffold's chat endpoint is the FIRST file a new developer
 * customises. After item #4 it MUST (a) import the SDK Agent, (b) declare
 * at least one tool via defineAgentTool, (c) use yield* streamAgentRun to
 * adapt the SDK Run lifecycle to AgentEvent SSE, (d) dispose the agent in
 * a finally block wrapped in try/catch (EC-2 — never mask the original error).
 */

const ROOT = resolve(__dirname, '../..')
const CHAT_PATH = resolve(ROOT, 'fixtures/template-default/server/routes/chat.ts')
const PKG_PATH = resolve(ROOT, 'fixtures/template-default/package.json')

function readChat(): string {
  return readFileSync(CHAT_PATH, 'utf-8')
}

describe('fixtures/template-default canonical chat.ts (item #5)', () => {
  it('uses @theokit/sdk indirectly via createConversationHistory (no naked Agent import needed)', () => {
    const src = readChat()
    // item #5: agent acquisition is via createConversationHistory which
    // dynamically imports the SDK. No direct `import { Agent } from '@theokit/sdk'`
    // line in the user-facing scaffold (kept clean).
    expect(src).toMatch(/createConversationHistory/)
    expect(src).not.toMatch(/import\s+\{\s*Agent\s*\}\s+from\s+['"]@theokit\/sdk['"]/)
  })

  it('does NOT import the raw "openai" npm package (anti-stack guard)', () => {
    // FAANG-precise: comments mentioning "OpenAI Chat Completions" (wire
    // protocol) + env var names like OPENAI_API_KEY are domain reality.
    // Block ONLY actual imports/requires of the openai pkg.
    const src = readChat()
    const rawSdkImport =
      /(?:from|require\(|import\()\s*['"]openai['"]/i.test(src) ||
      /from\s+['"]@anthropic-ai\/sdk['"]/i.test(src)
    expect(rawSdkImport).toBe(false)
  })

  it('imports defineAgentTool from theokit/server', () => {
    const src = readChat()
    expect(src).toMatch(/defineAgentTool/)
    expect(src).toMatch(/from\s+['"]theokit\/server['"]/)
  })

  it('declares at least one tool via defineAgentTool', () => {
    const src = readChat()
    const matches = src.match(/defineAgentTool\(/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('yield-delegates to streamAgentRun', () => {
    const src = readChat()
    expect(src).toMatch(/yield\*\s+streamAgentRun\(/)
  })

  it('item #5 — does NOT call agent.dispose() (continuity requires keeping it alive)', () => {
    const src = readChat()
    // Strip line comments before checking — the file MAY mention dispose in
    // an explanatory `// Intentionally NO agent.dispose()` comment.
    const codeOnly = src
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    expect(codeOnly).not.toMatch(/agent\.dispose\(/)
  })

  it('item #5 — imports createConversationHistory from theokit/server', () => {
    const src = readChat()
    expect(src).toMatch(/createConversationHistory/)
    expect(src).toMatch(/from\s+['"]theokit\/server['"]/)
  })

  it('item #5 — passes cookieHeaders to createConversationHistory', () => {
    const src = readChat()
    expect(src).toMatch(/createConversationHistory\([\s\S]*cookieHeaders/m)
  })

  it('documents env-var-based provider resolution (Strategy pattern handles it)', () => {
    // Provider routing is centralized in theokit/server (Strategy + Registry
    // pattern) — consumer chat.ts has ZERO conditionals on provider choice.
    // The env var names appear in informational comments so devs know which
    // keys to set; the actionable error is emitted by `resolveProvider()`.
    //
    // Updated (theokit-evolution-ci-and-dx Phase 5 dogfood fix): consumer
    // MUST wrap agent lifecycle in try/catch and yield `{type:"error"}` on
    // provider errors (invalid KEY, rate-limit, model-not-found, 5xx) so
    // client renders an actionable message instead of silent SSE closure.
    // Chaos Phase 12 validates this behavior.
    const src = readChat()
    expect(src).toMatch(/OPENROUTER_API_KEY/)
    expect(src).toMatch(/ANTHROPIC_API_KEY/)
    // Consumer SHOULD yield error events on caught exceptions
    expect(src).toMatch(/yield\s*\{\s*type:\s*['"]error['"]/)
    expect(src).toMatch(/try\s*\{[\s\S]*catch/)
  })

  it('EC-4 — guards against non-object body before destructuring', () => {
    const src = readChat()
    const hasTypeGuard = /typeof\s+body\s*===\s*['"]object['"]/.test(src)
    const hasArrayGuard = src.includes('Array.isArray(body)')
    const hasSafeDefault = /body\s*\?\?\s*\{\s*\}/.test(src) || /body\s*&&\s*typeof/.test(src)
    expect(hasTypeGuard || hasArrayGuard || hasSafeDefault).toBe(true)
  })

  it('exports POST from defineAgentEndpoint', () => {
    const src = readChat()
    expect(src).toMatch(/export\s+const\s+POST\s*=\s*defineAgentEndpoint/)
  })

  it('LOC budget for tool-calling + dual-provider chat.ts: <= 75 lines total', () => {
    const lineCount = readChat().split('\n').length
    expect(lineCount).toBeLessThanOrEqual(75)
  })
})

describe('fixtures/template-default package.json — @theokit/sdk dep', () => {
  it('includes @theokit/sdk in dependencies (npm registry ^2.x — SDK left the workspace 2026-06-10, bumped to 2.0.1 on 2026-06-19)', () => {
    expect(existsSync(PKG_PATH)).toBe(true)
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as {
      dependencies?: Record<string, string>
    }
    // `@theokit/sdk` is consumed from the npm registry (workspace links were
    // removed 2026-06-10 — Turborepo requires all workspace packages in-root),
    // so the fixture pins a registry range, not `workspace:*`. Bumped to the
    // 2.x major on 2026-06-19 (Harness surface unchanged across the major).
    expect(pkg.dependencies?.['@theokit/sdk']).toMatch(/^\^2\./)
  })
})
