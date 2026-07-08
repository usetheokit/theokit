import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const TEMPLATE_ROOT = resolve(__dirname, '../../packages/create-theokit/templates/default')

function read(rel: string): string {
  return readFileSync(resolve(TEMPLATE_ROOT, rel), 'utf-8')
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

  it('app/page.tsx uses ChatThread + ChatMessage + ChatComposer (conversation surface)', () => {
    // Post-2026-05-18 redesign: scaffold uses a proper chat surface with
    // ChatThread/ChatMessage/ChatComposer rather than the lower-level
    // AgentComposer + AgentTimeline pair, so a fresh `create-theokit my-app`
    // looks like a real product on first load.
    const page = read('app/page.tsx')
    expect(page).toContain('ChatThread')
    expect(page).toContain('ChatMessage')
    expect(page).toContain('ChatComposer')
  })

  it('app/page.tsx renders tool invocations via ChatMessage part auto-dispatch (#80, #85)', () => {
    // Post-#80, tool-call parts are rendered by ChatMessage's part auto-dispatch (it renders
    // text/tool-call/reasoning parts of each UIMessage) — the template no longer references
    // ToolCallCard directly. Assert the mechanism the template actually uses (behavior), not the
    // removed implementation detail (testing.md § 6 — do not assert internal structure).
    const page = read('app/page.tsx')
    expect(page).toContain('ChatMessage')
    expect(page).toMatch(/parts/)
    // Regression guard (#85): the obsolete "uses ToolCallCard" assertion is gone; the real template
    // (create-theokit/templates/default) fully migrated — ToolCallCard is no longer referenced.
    expect(page).not.toContain('ToolCallCard')
  })

  it('app/page.tsx uses AgentStreaming as the streaming indicator', () => {
    const page = read('app/page.tsx')
    expect(page).toContain('AgentStreaming')
  })

  it('app/page.tsx uses EmptyState for first-load (no messages yet)', () => {
    const page = read('app/page.tsx')
    expect(page).toContain('EmptyState')
  })

  it('app/page.tsx wires the full TheoUI agent product set (Avatar, ContextWindowBar, CommandPalette, Tooltip)', () => {
    // The default scaffold should look like an agent product on first load,
    // not a minimal chat box. These six components are the "agent shell"
    // signal — together they say: this is the home for your agent, not a
    // starting point you'll have to decorate yourself.
    const page = read('app/page.tsx')
    expect(page).toContain('Avatar')
    expect(page).toContain('ContextWindowBar')
    expect(page).toContain('CommandPalette')
    expect(page).toContain('Tooltip')
  })

  it('app/page.tsx wires ⌘K keyboard shortcut for CommandPalette', () => {
    const page = read('app/page.tsx')
    // Regression: keep the cmd/ctrl+K opener so the palette is discoverable.
    expect(page).toMatch(/metaKey|ctrlKey/)
    expect(page).toMatch(/'k'/)
  })

  it('app/layout.tsx wires CostMeter + Badge + Tooltip from TheoUI', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toContain('CostMeter')
    expect(layout).toContain('Badge')
    expect(layout).toContain('Tooltip')
  })

  it('app/layout.tsx declares an AgentProfile descriptor with badge + tone', () => {
    // The scaffold should ship an example descriptor so the AgentProfile
    // dropdown is non-empty out of the box — otherwise it just renders a
    // placeholder face.
    const layout = read('app/layout.tsx')
    expect(layout).toMatch(/AgentProfileDescriptor/)
    expect(layout).toMatch(/badge:\s*['"`]/)
    expect(layout).toMatch(/tone:\s*['"`]/)
  })

  it('app/page.tsx imports from @theokit/ui (not local stub)', () => {
    const page = read('app/page.tsx')
    expect(page).toMatch(/from ['"]@theokit\/ui['"]/)
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

  it('M3: page.tsx uses useAgent hook (not the removed useAgentStream) and references /api/agents/chat', () => {
    const page = read('app/page.tsx')
    expect(page).toMatch(/useAgent\b/)
    expect(page).not.toMatch(/useAgentStream/)
    expect(page).toMatch(/from\s+['"]theokit\/client['"]/)
    expect(page).toMatch(/\/api\/agents\/chat/)
  })

  it('M3: page.tsx does NOT manually parse SSE (no getReader / TextDecoder)', () => {
    // useAgent handles the UIMessageStream internally — the page never touches
    // the raw SSE reader or text decoder.
    const page = read('app/page.tsx')
    expect(page).not.toMatch(/getReader\(\)/)
    expect(page).not.toMatch(/new TextDecoder/)
  })

  it('layout.tsx does not manually wrap ThemeProvider (auto-injected via entry-client)', () => {
    const layout = read('app/layout.tsx')
    expect(layout).not.toContain('TheoUIProvider')
    // ThemeProvider is fine to mention only if not as a JSX wrapper — exclude
    // the JSX-call form `<ThemeProvider`.
    expect(layout).not.toMatch(/<ThemeProvider/)
  })

  it('layout.tsx uses TopNav + Sidebar app shell from TheoUI', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toContain('TopNav')
    expect(layout).toContain('Sidebar')
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
