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
    expect(src).toMatch(/export\s+default\s+AgentBuilder\.create\(\)/)
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
  it('package.json.tmpl pins @theokit/sdk at or above the floor the framework declares (M6 EC-7)', () => {
    // Defensive grep — JSON.parse would fail on the {{name}} placeholder.
    //
    // O guarda nasceu no M6 congelando `^2.13`: `@theokit/agents@0.30.x` exigia o subpath
    // `@theokit/sdk/compaction`, publicado pela primeira vez em 2.13.0, e um `npx create-theokit`
    // sob o pin `^1` antigo quebrava com ERR_PACKAGE_PATH_NOT_EXPORTED. O piso mudou desde então
    // (ADR 0060 o levou a `^4.49.0`, a menor versão em que a família config/trust/wiring existe) e
    // o literal ficou vermelho por default — irmão exato do guarda da fixture que o M67 consertou,
    // e dos guardas do peer `@theokit/ui` (backlog B-M67-01).
    //
    // A propriedade que ele sempre quis expressar é **coerência**: o piso que o template pina não
    // pode ficar ABAIXO do piso que o framework declara como peer, senão um lockfile que resolva o
    // piso do template não satisfaz o peer e o scaffold recém-criado não instala. Isso não precisa
    // de edição quando a linha legitimamente avança.
    const src = readFileSync(TEMPLATE_PKG, 'utf-8')
    const templatePin = /"@theokit\/sdk":\s*"(\^\d+\.\d+\.\d+)"/.exec(src)?.[1]
    expect(templatePin, 'the template must pin @theokit/sdk as a caret').toBeTruthy()

    const frameworkPeer = (
      JSON.parse(readFileSync(resolve(ROOT, 'packages/theo/package.json'), 'utf-8')) as {
        peerDependencies: Record<string, string>
      }
    ).peerDependencies['@theokit/sdk']
    const asTuple = (pin: string): [number, number, number] => {
      const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(pin)
      expect(m, `not a caret pin: ${pin}`).toBeTruthy()
      return [Number(m![1]), Number(m![2]), Number(m![3])]
    }
    const [tMaj, tMin, tPat] = asTuple(templatePin!)
    const [pMaj, pMin, pPat] = asTuple(frameworkPeer)
    expect(
      tMaj === pMaj && (tMin > pMin || (tMin === pMin && tPat >= pPat)),
      `o template pina "${templatePin}", abaixo do peer que o framework declara ("${frameworkPeer}") — ` +
        `um lockfile no piso do template não satisfaz o peer`,
    ).toBe(true)
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
