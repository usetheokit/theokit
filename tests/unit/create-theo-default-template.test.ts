import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * M3 (clean break) — canonical agents/chat.ts + @theokit/sdk dep in `create-theokit` template.
 *
 * Mirrors fixtures/template-default. Verified via:
 *   - Byte-identical agents/chat.ts bodies (defends drift)
 *   - regex grep on package.json.tmpl (NOT JSON.parse — Mustache placeholders
 *     `{{name}}` make the template invalid JSON; EC-7)
 *   - defineAgent shape assertions (no proprietary surface references)
 */

const ROOT = resolve(__dirname, '../..')
const FIXTURE_CHAT = resolve(ROOT, 'fixtures/template-default/agents/chat.ts')
const TEMPLATE_CHAT = resolve(ROOT, 'packages/create-theokit/templates/default/agents/chat.ts')
const TEMPLATE_PKG = resolve(ROOT, 'packages/create-theokit/templates/default/package.json.tmpl')

function normalize(s: string): string {
  // Strip trailing whitespace per line + collapse multiple blank lines
  return s
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

describe('create-theokit default template — agents/chat.ts parity with fixture (M3)', () => {
  it('agents/chat.ts bodies are identical (whitespace-normalised) — defends drift', () => {
    const fixture = normalize(readFileSync(FIXTURE_CHAT, 'utf-8'))
    const template = normalize(readFileSync(TEMPLATE_CHAT, 'utf-8'))
    expect(template).toBe(fixture)
  })

  it('template agents/chat.ts default-exports defineAgent (M3 — replaces defineAgentEndpoint)', () => {
    const src = readFileSync(TEMPLATE_CHAT, 'utf-8')
    expect(src).toMatch(/export\s+default\s+defineAgent\(/)
    expect(src).toMatch(/from\s+['"]@theokit\/agents['"]/)
  })

  it('template agents/chat.ts declares a Zod input schema (typed end-to-end client)', () => {
    const src = readFileSync(TEMPLATE_CHAT, 'utf-8')
    expect(src).toMatch(/input:\s*z\.object\(/)
  })

  it('template agents/chat.ts does NOT import the raw openai npm package', () => {
    // FAANG-precise: comments mentioning "OpenAI Chat Completions" (the wire
    // protocol) + env var names like OPENAI_API_KEY are domain reality.
    // The anti-stack rule blocks actual imports/requires of the openai pkg.
    const src = readFileSync(TEMPLATE_CHAT, 'utf-8')
    const rawSdkImport =
      /(?:from|require\(|import\()\s*['"]openai['"]/i.test(src) ||
      /from\s+['"]@anthropic-ai\/sdk['"]/i.test(src)
    expect(rawSdkImport).toBe(false)
  })

  it('template agents/chat.ts does NOT reference the removed proprietary surface', () => {
    // M3: defineAgentEndpoint, streamAgentRun, createConversationHistory, and
    // AgentEvent are all removed. The new surface is defineAgent + useAgent.
    const src = readFileSync(TEMPLATE_CHAT, 'utf-8')
    expect(src).not.toMatch(/defineAgentEndpoint|streamAgentRun|createConversationHistory/)
  })

  it('template agents/chat.ts declares a model', () => {
    const src = readFileSync(TEMPLATE_CHAT, 'utf-8')
    expect(src).toMatch(/model:\s*['"]/)
  })
})

describe('create-theokit default template — package.json.tmpl SDK dep (EC-7)', () => {
  it('package.json.tmpl includes @theokit/sdk via regex grep (NOT JSON.parse — Mustache breaks parse)', () => {
    const src = readFileSync(TEMPLATE_PKG, 'utf-8')
    // Defensive grep — JSON.parse would fail on {{name}} placeholder
    expect(src).toMatch(/"@theokit\/sdk":\s*"\^1/)
  })

  it('package.json.tmpl still preserves {{name}} placeholder (sanity)', () => {
    const src = readFileSync(TEMPLATE_PKG, 'utf-8')
    expect(src).toContain('{{name}}')
  })
})
