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

  it('template agents/chat.ts default-exports the agent() builder (M31 builder-only API)', () => {
    const src = readFileSync(TEMPLATE_CHAT, 'utf-8')
    expect(src).toMatch(/export\s+default\s+agent\(\)/)
    expect(src).toMatch(/\.build\(\)/)
    expect(src).toMatch(/from\s+['"]@theokit\/agents['"]/)
  })

  it('template agents/chat.ts declares a Zod input schema (typed end-to-end client)', () => {
    const src = readFileSync(TEMPLATE_CHAT, 'utf-8')
    expect(src).toMatch(/\.input\(\s*z\.object\(/)
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
    expect(src).toMatch(/\.model\(\s*['"]/)
  })
})

describe('create-theokit default template — package.json.tmpl SDK dep (EC-7)', () => {
  it('package.json.tmpl pins @theokit/sdk at the 2.13+ compaction floor (M6, EC-7)', () => {
    const src = readFileSync(TEMPLATE_PKG, 'utf-8')
    // Defensive grep — JSON.parse would fail on {{name}} placeholder.
    // M6 bumped this pin from ^1.x to ^2.13.0: @theokit/agents@0.30.x requires the
    // `@theokit/sdk` `./compaction` subpath export, first shipped in 2.13.0. A fresh
    // `npx create-theokit` → `pnpm install` failed with ERR_PACKAGE_PATH_NOT_EXPORTED
    // under the old ^1 pin. This guard locks the FLOOR that carries the export — any
    // `^2.<minor>` with minor >= 13 satisfies it (the template legitimately tracks a
    // higher minor over time; the regex allows 2.13 through 2.99).
    expect(src).toMatch(/"@theokit\/sdk":\s*"\^2\.(1[3-9]|[2-9]\d)\./)
  })

  it('package.json.tmpl still preserves {{name}} placeholder (sanity)', () => {
    const src = readFileSync(TEMPLATE_PKG, 'utf-8')
    expect(src).toContain('{{name}}')
  })
})

const TEMPLATE_AGENTS_SKILL = resolve(
  ROOT,
  'packages/create-theokit/templates/default/dot-claude/skills/theokit-agents/SKILL.md',
)

describe('create-theokit theokit-agents SKILL — defineAgentTool signature (issue #79)', () => {
  // Extract ONLY the `defineAgentTool({ ... })` call — the surrounding `defineAgent({ input })`
  // and the `### @Tool({ input })` decorator example legitimately use `input:` (their real field);
  // the guard must target the defineAgentTool spec, whose real fields are inputSchema + handler.
  function defineAgentToolCall(): string {
    const md = readFileSync(TEMPLATE_AGENTS_SKILL, 'utf-8')
    const open = md.indexOf('defineAgentTool({')
    expect(open, 'SKILL.md must contain a defineAgentTool({ ... }) example').toBeGreaterThan(-1)
    // The call closes with `\n})` at line start; nested `})` (e.g. `z.object({})`) are inline.
    const close = md.indexOf('\n})', open)
    expect(close).toBeGreaterThan(open)
    return md.slice(open, close + 3)
  }

  it('teaches the real DefineAgentToolSpec fields (inputSchema + handler)', () => {
    const call = defineAgentToolCall()
    // Real API: define-agent-tool.ts DefineAgentToolSpec = { inputSchema, handler: () => string }.
    expect(call).toMatch(/inputSchema:/)
    expect(call).toMatch(/handler:/)
  })

  it('does NOT use the wrong input:/execute: shape (the pre-fix drift users copy)', () => {
    const call = defineAgentToolCall()
    expect(call).not.toMatch(/\binput:/)
    expect(call).not.toMatch(/\bexecute:/)
  })
})
