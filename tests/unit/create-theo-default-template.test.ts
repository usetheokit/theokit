import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * M3 (clean break) — canonical agents/chat.ts + @theokit/sdk dep in `create-theokit` template.
 *
 * Verified via:
 *   - regex grep on package.json.tmpl (NOT JSON.parse — Mustache placeholders
 *     `{{name}}` make the template invalid JSON; EC-7)
 *   - defineAgent shape assertions (no proprietary surface references)
 *
 * The template has no checked-in mirror to diff against, so the assertions below guard its
 * CONTENT directly rather than its equality with a second copy.
 */

const ROOT = resolve(__dirname, '../..')
const TEMPLATE_CHAT = resolve(ROOT, 'packages/create-theokit/templates/default/agents/chat.ts')
const TEMPLATE_PKG = resolve(ROOT, 'packages/create-theokit/templates/default/package.json.tmpl')

describe('create-theokit default template — agents/chat.ts shape (M3)', () => {
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
    // The literal is the FALLBACK now, not the whole argument: the template reads
    // the documented LLM_MODEL override where the model is declared (#398, #408),
    // so a scaffold still runs with no environment while honouring one that has it.
    const src = readFileSync(TEMPLATE_CHAT, 'utf-8')
    expect(src).toMatch(/\.model\([^)]*['"][\w-]+\/[\w.-]+['"]/u)
  })
})

describe('create-theokit default template — package.json.tmpl SDK dep (EC-7)', () => {
  it('package.json.tmpl pins @theokit/sdk at or above the floor the framework declares (M6 EC-7)', () => {
    // Defensive grep — JSON.parse would fail on the {{name}} placeholder.
    //
    // The guard was born in M6 freezing `^2.13`: `@theokit/agents@0.30.x` required the
    // `@theokit/sdk/compaction` subpath, first shipped in 2.13.0, and an `npx create-theokit` under
    // the old `^1` pin broke with ERR_PACKAGE_PATH_NOT_EXPORTED. The floor has moved since (ADR 0060
    // took it to `^4.49.0`, the lowest version where the config/trust/wiring family exists) and the
    // literal went red by default — exact sibling of the fixture guard M67 fixed, and of the
    // `@theokit/ui` peer guards (backlog B-M67-01).
    //
    // The property it always meant to express is **coherence**: the floor the template pins may not
    // sit BELOW the floor the framework declares as a peer, or a lockfile resolving the template's
    // floor does not satisfy the peer and the freshly created scaffold does not install. That needs
    // no edit when the line legitimately advances.
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
      `the template pins "${templatePin}", below the peer the framework declares ("${frameworkPeer}") — ` +
        `a lockfile at the template's floor does not satisfy the peer`,
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
