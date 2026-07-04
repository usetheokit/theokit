import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * M3 (clean break) — the default scaffold's chat agent is now the zero-config
 * `agents/chat.ts` convention (the pre-M2 `server/routes/chat.ts` +
 * `defineAgentEndpoint` surface was removed). The canonical file MUST:
 *   (a) `export default defineAgent({...})` from `@theokit/agents`,
 *   (b) declare a Zod `input` schema (end-to-end typed client),
 *   (c) declare a `model`,
 *   (d) NOT reference the removed surface (defineAgentEndpoint / streamAgentRun /
 *       createConversationHistory / AgentEvent),
 *   (e) NOT import a raw LLM SDK (anti-stack guard — the SDK owns the provider).
 */

const ROOT = resolve(__dirname, '../..')
const AGENT_PATH = resolve(ROOT, 'fixtures/template-default/agents/chat.ts')
const PAGE_PATH = resolve(ROOT, 'fixtures/template-default/app/page.tsx')
const PKG_PATH = resolve(ROOT, 'fixtures/template-default/package.json')
const OLD_CHAT = resolve(ROOT, 'fixtures/template-default/server/routes/chat.ts')

function readAgent(): string {
  return readFileSync(AGENT_PATH, 'utf-8')
}

describe('fixtures/template-default canonical agents/chat.ts (M3)', () => {
  it('the pre-M2 server/routes/chat.ts is removed', () => {
    expect(existsSync(OLD_CHAT)).toBe(false)
  })

  it('agents/chat.ts exists and default-exports defineAgent', () => {
    expect(existsSync(AGENT_PATH)).toBe(true)
    const src = readAgent()
    expect(src).toMatch(/export\s+default\s+defineAgent\(/)
    expect(src).toMatch(/from\s+['"]@theokit\/agents['"]/)
  })

  it('declares a Zod input schema (typed end-to-end client)', () => {
    const src = readAgent()
    expect(src).toMatch(/input:\s*z\.object\(/)
  })

  it('declares a model', () => {
    const src = readAgent()
    expect(src).toMatch(/model:\s*['"]/)
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

  it('the client page consumes the agent via useAgent (not the removed useAgentStream)', () => {
    const page = readFileSync(PAGE_PATH, 'utf-8')
    expect(page).toMatch(/useAgent\b/)
    expect(page).not.toMatch(/useAgentStream/)
    expect(page).toMatch(/\/api\/agents\/chat/)
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
