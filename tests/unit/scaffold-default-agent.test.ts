import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const TEMPLATE_ROOT = resolve(__dirname, '../../packages/create-theokit/templates/default')

function read(rel: string): string {
  return readFileSync(resolve(TEMPLATE_ROOT, rel), 'utf-8')
}

/**
 * Concatenate every PRODUCTION source file under `app/` (excludes `*.test.*` / `*.spec.*`). The chat
 * surface is composed across `page.tsx` + `components/` + `hooks/` — asserting the surface exists ANYWHERE
 * in the app tree keeps these checks intent-focused (does the scaffold use ChatThread / useAgent / …) and
 * refactor-proof, instead of coupling to which file currently holds each symbol.
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
  walk(resolve(TEMPLATE_ROOT, 'app'))
  return chunks.join('\n')
}

describe('create-theokit default template — agent surface (T3.1)', () => {
  it('package.json.tmpl includes @theokit/ui in dependencies', () => {
    const pkg = read('package.json.tmpl')
    expect(pkg).toMatch(/"@theokit\/ui"/)
  })

  it('package.json.tmpl declares theokit peer dependencies (regression — smoke real)', () => {
    // Bug found by `pnpm dlx create-theokit@0.1.0-alpha.3 my-real-test` smoke:
    // theokit declares react-router and zod as peer deps, but the template
    // forgot to declare them, breaking dev server on first start.
    const pkg = read('package.json.tmpl')
    expect(pkg).toMatch(/"react-router"/)
    expect(pkg).toMatch(/"zod"/)
  })

  it('package.json.tmpl includes react + react-dom (UI runtime)', () => {
    const pkg = read('package.json.tmpl')
    expect(pkg).toMatch(/"react"/)
    expect(pkg).toMatch(/"react-dom"/)
  })

  it('app surface uses ChatThread + ChatMessage + ChatComposer (conversation surface)', () => {
    // Post-2026-05-18 redesign: scaffold uses a proper chat surface with
    // ChatThread/ChatMessage/ChatComposer rather than the lower-level
    // AgentComposer + AgentTimeline pair, so a fresh `create-theokit my-app`
    // looks like a real product on first load. The surface is composed across
    // page.tsx + components/ (ChatPanel, Composer) — scan the whole app tree.
    const app = readAppTree()
    expect(app).toContain('ChatThread')
    expect(app).toContain('ChatMessage')
    expect(app).toContain('ChatComposer')
  })

  it('app surface renders tool invocations via ChatMessage part auto-dispatch (#80, #85)', () => {
    // Post-#80, tool-call parts are rendered by ChatMessage's part auto-dispatch (it renders
    // text/tool-call/reasoning parts of each UIMessage) — the template no longer references
    // ToolCallCard directly. Assert the mechanism the template actually uses (behavior), not the
    // removed implementation detail (testing.md § 6 — do not assert internal structure).
    const app = readAppTree()
    expect(app).toContain('ChatMessage')
    expect(app).toMatch(/parts/)
    // Regression guard (#85): the obsolete "uses ToolCallCard" assertion is gone; the real template
    // (create-theokit/templates/default) fully migrated — ToolCallCard is no longer referenced.
    expect(app).not.toContain('ToolCallCard')
  })

  it('app surface uses AgentStreaming as the streaming indicator', () => {
    const app = readAppTree()
    expect(app).toContain('AgentStreaming')
  })

  it('app surface imports from @theokit/ui (not local stub)', () => {
    const app = readAppTree()
    expect(app).toMatch(/from ['"]@theokit\/ui['"]/)
  })

  it('app/page.tsx is a Client Component ("use client" directive)', () => {
    const page = read('app/page.tsx')
    expect(page.trim().startsWith("'use client'") || page.trim().startsWith('"use client"')).toBe(
      true,
    )
  })

  // M3 (clean break) — the default scaffold's chat agent is now the zero-config
  // `agents/chat.ts` convention. The pre-M2 `server/routes/chat.ts` +
  // `defineAgentEndpoint` surface was removed entirely. Tests below assert the
  // new shape and the absence of the old surface.

  it('M3: server/routes/chat.ts is absent (removed in clean break)', () => {
    expect(existsSync(resolve(TEMPLATE_ROOT, 'server/routes/chat.ts'))).toBe(false)
  })

  it('M31: agents/chat.ts default-exports the agent() builder from @theokit/agents', () => {
    const agent = read('agents/chat.ts')
    expect(agent).toMatch(/export\s+default\s+agent\(\)/)
    expect(agent).toMatch(/\.build\(\)/)
    expect(agent).toMatch(/from\s+['"]@theokit\/agents['"]/)
  })

  it('M31: agents/chat.ts declares a Zod input schema (typed end-to-end client)', () => {
    const agent = read('agents/chat.ts')
    expect(agent).toMatch(/\.input\(\s*z\.object\(/)
  })

  it('M31: agents/chat.ts declares a model', () => {
    const agent = read('agents/chat.ts')
    expect(agent).toMatch(/\.model\(\s*['"]/)
  })

  it('M3: agents/chat.ts does NOT reference the removed proprietary surface', () => {
    const agent = read('agents/chat.ts')
    expect(agent).not.toMatch(
      /defineAgentEndpoint|streamAgentRun|createConversationHistory|AgentEvent/,
    )
  })

  it('M3: agents/chat.ts does NOT import a raw LLM SDK (anti-stack guard — the SDK owns the provider)', () => {
    const agent = read('agents/chat.ts')
    const rawSdkImport =
      /(?:from|require\(|import\()\s*['"]openai['"]/i.test(agent) ||
      /from\s+['"]@anthropic-ai\/sdk['"]/i.test(agent)
    expect(rawSdkImport).toBe(false)
  })

  it('M3: app surface uses useAgent hook (not the removed useAgentStream) and references /api/agents/chat', () => {
    // useAgent + the /api/agents/chat wiring live in the transcript hook (app/hooks/use-transcript.ts);
    // scan the whole app tree so the check follows the hook wherever it's composed from.
    const app = readAppTree()
    expect(app).toMatch(/useAgent\b/)
    expect(app).not.toMatch(/useAgentStream/)
    expect(app).toMatch(/from\s+['"]theokit\/client['"]/)
    expect(app).toMatch(/\/api\/agents\/chat/)
  })

  it('M3: app surface does NOT manually parse SSE (no getReader / TextDecoder)', () => {
    // useAgent handles the UIMessageStream internally — no file in the app tree touches the raw SSE
    // reader or text decoder.
    const app = readAppTree()
    expect(app).not.toMatch(/getReader\(\)/)
    expect(app).not.toMatch(/new TextDecoder/)
  })

  it('layout.tsx does not manually wrap ThemeProvider (auto-injected via entry-client)', () => {
    const layout = read('app/layout.tsx')
    expect(layout).not.toContain('TheoUIProvider')
    // ThemeProvider is fine to mention only if not as a JSX wrapper — exclude
    // the JSX-call form `<ThemeProvider`.
    expect(layout).not.toMatch(/<ThemeProvider/)
  })

  it('layout.tsx calls <Outlet /> from react-router (regression — black page bug)', () => {
    // Live demo failure 2026-05-18: layout returned `{children}` (Next.js
    // convention) but the router-generated manifest passes children via
    // <Outlet />. The generator now wraps with `children: <Outlet />`, but
    // the canonical layout in the template should still import Outlet
    // directly so it works regardless of router-side wiring.
    const layout = read('app/layout.tsx')
    expect(layout).toMatch(/import\s*\{[^}]*\bOutlet\b/)
    expect(layout).toMatch(/<Outlet/)
  })

  it('zero-config: template DOES NOT ship tailwind.config.ts or postcss.config.js (Phase 3 / @theokit/ui ^0.5)', () => {
    expect(() => read('tailwind.config.ts')).toThrow()
    expect(() => read('postcss.config.js')).toThrow()
  })

  it('layout imports @theokit/ui/styles.css (Tailwind v4 entry — pre-bundled by @theokit/ui)', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toMatch(/import\s+['"]@theokit\/ui\/styles\.css['"]/)
  })

  it('package.json.tmpl declares tailwindcss@^4 + @tailwindcss/vite (v4 zero-config) + lucide-react', () => {
    const pkg = read('package.json.tmpl')
    expect(pkg).toMatch(/"tailwindcss":\s*"\^4/)
    expect(pkg).toMatch(/"@tailwindcss\/vite":\s*"\^4/)
    expect(pkg).toMatch(/"lucide-react"/)
    // v3 toolchain removed — TheoKit's vite-plugin auto-chains v4 + UI plugin
    expect(pkg).not.toMatch(/"postcss":/)
    expect(pkg).not.toMatch(/"autoprefixer":/)
    expect(pkg).not.toMatch(/"tailwindcss-animate":/)
  })
})
