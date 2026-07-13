import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * M3 (clean break) — the default scaffold's chat agent is now the zero-config
 * `agents/chat.ts` convention (the pre-M2 `server/routes/chat.ts` +
 * `defineAgentEndpoint` surface was removed). The canonical file MUST:
 *   (a) `export default agent()...build()` from `@theokit/agents` (M31 builder-only API),
 *   (b) declare a Zod `.input()` schema (end-to-end typed client),
 *   (c) declare a `.model()`,
 *   (d) NOT reference the removed surface (defineAgentEndpoint / streamAgentRun /
 *       createConversationHistory / AgentEvent),
 *   (e) NOT import a raw LLM SDK (anti-stack guard — the SDK owns the provider).
 */

const ROOT = resolve(__dirname, '../..')
const AGENT_PATH = resolve(ROOT, 'fixtures/template-default/agents/chat.ts')
const PKG_PATH = resolve(ROOT, 'fixtures/template-default/package.json')
const OLD_CHAT = resolve(ROOT, 'fixtures/template-default/server/routes/chat.ts')

function readAgent(): string {
  return readFileSync(AGENT_PATH, 'utf-8')
}

/**
 * Concatenate every production source file under the fixture's `app/` (excludes `*.test.*`). The chat
 * surface is composed across `page.tsx` + `components/` + `hooks/`, so the `useAgent` wiring lives in
 * `hooks/use-transcript.ts`; scan the tree so the check follows the hook wherever it's composed from.
 */
function readAppTree(): string {
  const chunks: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        chunks.push(readFileSync(full, 'utf-8'))
      }
    }
  }
  walk(resolve(ROOT, 'fixtures/template-default/app'))
  return chunks.join('\n')
}

describe('fixtures/template-default canonical agents/chat.ts (M3)', () => {
  it('the pre-M2 server/routes/chat.ts is removed', () => {
    expect(existsSync(OLD_CHAT)).toBe(false)
  })

  it('agents/chat.ts exists and default-exports the agent() builder', () => {
    expect(existsSync(AGENT_PATH)).toBe(true)
    const src = readAgent()
    // M31 builder-only: `export default agent()...build()` (was `defineAgent({...})`).
    expect(src).toMatch(/export\s+default\s+agent\(\)/)
    expect(src).toMatch(/\.build\(\)/)
    expect(src).toMatch(/from\s+['"]@theokit\/agents['"]/)
  })

  it('declares a Zod input schema (typed end-to-end client)', () => {
    const src = readAgent()
    expect(src).toMatch(/\.input\(\s*z\.object\(/)
  })

  it('declares a model', () => {
    const src = readAgent()
    expect(src).toMatch(/\.model\(\s*['"]/)
  })

  it('does NOT reference the removed proprietary surface', () => {
    const src = readAgent()
    expect(src).not.toMatch(
      /defineAgentEndpoint|streamAgentRun|createConversationHistory|AgentEvent/,
    )
  })

  it('does NOT import a raw LLM SDK (anti-stack guard — the SDK owns the provider)', () => {
    const src = readAgent()
    const rawSdkImport =
      /(?:from|require\(|import\()\s*['"]openai['"]/i.test(src) ||
      /from\s+['"]@anthropic-ai\/sdk['"]/i.test(src)
    expect(rawSdkImport).toBe(false)
  })

  it('the client app consumes the agent via useAgent (not the removed useAgentStream)', () => {
    const app = readAppTree()
    expect(app).toMatch(/useAgent\b/)
    expect(app).not.toMatch(/useAgentStream/)
    expect(app).toMatch(/\/api\/agents\/chat/)
  })

  it('LOC budget for the zero-config agent file: <= 40 lines', () => {
    expect(readAgent().split('\n').length).toBeLessThanOrEqual(40)
  })
})

describe('fixtures/template-default package.json — @theokit/sdk dep', () => {
  it('includes @theokit/sdk in dependencies (npm registry ^2.x)', () => {
    expect(existsSync(PKG_PATH)).toBe(true)
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['@theokit/sdk']).toMatch(/^\^2\./)
  })
})
