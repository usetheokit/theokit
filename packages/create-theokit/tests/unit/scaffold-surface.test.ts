/**
 * M45 (ADR-0054) — `create-theokit --surface web|tui|desktop`. Scaffolds the terminal (Ink) and
 * desktop (Tauri) surfaces, each wired to the M41/M42/M44 unified client (the DX-track payoff — NOT the
 * raw seam). `--surface` is a flag (mirrors `--backend`); the boilerplate lives in scaffolder templates.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scaffold } from '../../src/index.js'
import { applySurface, parseSurfaceFlags } from '../../src/scaffold-surface.js'

describe('parseSurfaceFlags (M45)', () => {
  it('defaults to web', () => {
    expect(parseSurfaceFlags([])).toBe('web')
  })
  it('parses `--surface tui` and `--surface=desktop`', () => {
    expect(parseSurfaceFlags(['--surface', 'tui'])).toBe('tui')
    expect(parseSurfaceFlags(['--surface=desktop'])).toBe('desktop')
  })
  it('throws fail-fast on an unknown surface', () => {
    expect(() => parseSurfaceFlags(['--surface=mobile'])).toThrow(
      /unknown --surface value: 'mobile'/,
    )
  })
})

describe('applySurface (M45)', () => {
  let targetDir: string
  beforeEach(() => {
    targetDir = join(tmpdir(), `cts-surface-${randomUUID()}`)
  })
  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true })
  })
  const read = (p: string): string => readFileSync(join(targetDir, p), 'utf-8')

  it('web is a no-op — keeps the web app', () => {
    scaffold(targetDir, 'app')
    applySurface({ targetDir, projectName: 'app', surface: 'web' })
    expect(existsSync(join(targetDir, 'app'))).toBe(true)
  })

  it('tui scaffolds an Ink app on useAgent(InProcessTransport) and drops the web UI', () => {
    scaffold(targetDir, 'my-tui')
    applySurface({ targetDir, projectName: 'my-tui', surface: 'tui' })

    expect(existsSync(join(targetDir, 'tui/main.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'tui/App.tsx'))).toBe(true)
    // `npm run demo:tools` — a visual reference of every tool render state (renders AgentTimeline via the
    // same messagesToAgentEvents path, using tui/theme.ts). No agent/LLM needed.
    expect(existsSync(join(targetDir, 'tui/tool-variations.tsx'))).toBe(true)
    const demo = read('tui/tool-variations.tsx')
    expect(demo).toContain('AgentTimeline')
    expect(demo).toContain('messagesToAgentEvents')
    expect(demo).toContain("from './theme.js'")
    expect(demo).toContain('output-error') // the failed-tool state is exercised

    // ADR-0054 D2 — the unified client, NOT the raw seam consumption.
    const app = read('tui/App.tsx')
    expect(app).toContain('InProcessTransport')
    expect(app).toContain('useAgent')
    expect(app).toContain('streamAgentTurnInProcess')
    expect(read('tui/components/Banner.tsx')).toContain('my-tui') // {{name}} substituted (name lives in Banner)
    // Claude-Code render + AI-FREE: `<AgentTimeline>` (Markdown + tool cards) fed by `messagesToAgentEvents`
    // (the ai-free projection from `@theokit/tui`), NOT `<ChatThread>`/`@theokit/tui/ai-sdk`/`ai`.
    expect(app).toContain("from '@theokit/tui'")
    expect(app).toContain('AgentTimeline')
    expect(app).toContain('messagesToAgentEvents')
    // Footer telemetry: the two-line StatusFooter shows real context usage from the last turn's usage
    // (readTurnUsage over `agent.thread`), against the app-declared context window.
    expect(app).toContain('readTurnUsage')
    expect(app).toContain('AGENT.contextWindow')
    // Global style lives in ONE editable file `tui/theme.ts` (the DX win): accent, banner wordmark + copy,
    // spinner words, placeholder. The App imports it and never needs touching for a restyle.
    const theme = read('tui/theme.ts')
    expect(theme).toContain('#d97757') // Claude Code's coral accent
    expect(theme).toContain('export const ACCENT')
    expect(theme).toContain('export const THEME')
    expect(theme).toContain('export const LOGO')
    expect(theme).toContain('export const THINKING_PHRASES')
    expect(theme).toContain('export const PLACEHOLDER')
    // Monochrome-by-default chrome: color is reserved for meaning (tool states/errors keep it).
    expect(theme).toContain("accent: ''")
    expect(theme).toContain("assistant: { prefix: '' }")
    expect(theme).toContain('export const BANNER_TIPS')
    expect(app).toContain("from './theme.js'")
    // Componentized surface (create-theokit@1.23.0): App.tsx is the composition root; Banner / UsagePanel /
    // Demos live under tui/components/*. App imports the three children and composes them under <Stack>.
    expect(app).toContain("from './components/Banner.js'")
    expect(app).toContain("from './components/UsagePanel.js'")
    expect(app).toContain("from './components/Demos.js'")
    expect(app).toContain('<Banner />')
    expect(app).toContain('<UsagePanel')
    expect(app).toContain('<DemoSurface')
    expect(app).toContain('Stack')
    // The moved surfaces are NO LONGER in App.tsx — they live in their component files (prevents regressing
    // back to the monolith).
    expect(app).not.toContain('function Banner()')
    expect(app).not.toContain('PlanApproval')
    expect(app).not.toContain('ContextWindowBar')
    // App.tsx composition-root concerns stay here.
    expect(app).toContain('THINKING_PHRASES')
    expect(app).toContain('tokens={lastUsage?.totalTokens}')
    expect(app).toContain('<Notice variant="error">')
    expect(app).toContain('StatusFooter')
    expect(app).toContain('tokenDirection="down"')
    expect(app).toContain('Toast')
    expect(app).toContain('KeyboardHelp')
    expect(app).toContain('DEFAULT_COMPOSER_SHORTCUTS')
    expect(app).toContain('onHelpToggle')
    expect(app).toContain('exitArmed')
    expect(app).toContain("name: 'progress'") // the demo slash commands are exposed in the composer palette
    // HITL stays in the root: findPendingApproval → PermissionPrompt (numbered yes/no, decision === 'yes' →
    // approve) settles via agent.approve; InkInputProvider bridges Ink stdin to the prompt.
    expect(app).toContain('findPendingApproval')
    expect(app).toContain('PermissionPrompt')
    expect(app).toContain("decision === 'yes'")
    expect(app).toContain('InkInputProvider')
    expect(app).toContain('settleApproval')
    expect(app).toContain('agent.approve(approvalId, { approved })')
    expect(app).toContain('settledApprovals')
    // Banner component (moved out of App.tsx): the Claude-Code two-column welcome box.
    const banner = read('tui/components/Banner.tsx')
    expect(banner).toContain('export function Banner()')
    expect(banner).toContain('✻ Welcome to')
    expect(banner).toContain('{LOGO}')
    expect(banner).toContain('Tips for getting started')
    expect(banner).toContain('What&apos;s new')
    // UsagePanel component: the /usage observability trio, prop-driven from the real TurnUsage.
    const usagePanel = read('tui/components/UsagePanel.tsx')
    expect(usagePanel).toContain('usedTokens={usage.inputTokens}') // wired to REAL usage, not fake data
    for (const sym of ['ContextWindowBar', 'TokenUsageChart', 'CostMeter']) {
      expect(usagePanel).toContain(sym)
    }
    // Demos component: the deletable slash-command showcase — every interactive 0.40.0 surface lives here.
    const demos = read('tui/components/Demos.tsx')
    expect(demos).toContain('export function DemoSurface')
    for (const sym of [
      'PlanApproval',
      'QuestionPrompt',
      'SelectList',
      'MultiStepProgress',
      'ProgressActivity',
      'ProgressBar',
    ]) {
      expect(demos).toContain(sym)
    }
    // System Design ships with the surface (README-surface.md § Architecture).
    const surfaceReadme = read('README-surface.md')
    expect(surfaceReadme).toContain('## Architecture')
    expect(surfaceReadme).toContain('components/Demos')
    expect(surfaceReadme).toContain('useAgent')
    const main = read('tui/main.tsx')
    expect(main).toContain('exitOnCtrlC: false')
    expect(app).not.toContain('ChatThread')
    expect(app).not.toContain('@theokit/tui/ai-sdk')
    expect(app).not.toContain("from 'ai'")
    // M46 — the store owns the conversation: the template renders `useAgent().thread` directly (no
    // hand-rolled history/commit-once) and only prepends the warm greeting.
    expect(app).toContain('agent.thread')
    expect(app).not.toContain('setHistory')
    expect(app).toContain('GREETING')

    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(pkg.dependencies['@theokit/tui']).toBeDefined() // M46 renders the conversation
    expect(pkg.dependencies.ink).toBeDefined()
    // ink MUST be the React-19 line (^7) — ink@5 crashes on React 19 with `ReactCurrentOwner`, and the
    // default template pins react@19. Never regress below ^7 (found by dogfooding the TUI end-to-end).
    expect(pkg.dependencies.ink).toMatch(/\^?[7-9]/)
    // figlet (WelcomeBanner ASCII) + lowlight (ChatMessage highlight) are @theokit/tui PEERS the app
    // relies on. They MUST be declared: pnpm never auto-installs peers, so without these the scaffolded
    // TUI crashes at boot under pnpm (found by dogfooding the TUI end-to-end on the @theokit/tui@0.31 bump).
    expect(pkg.dependencies.figlet).toBeDefined()
    expect(pkg.dependencies.lowlight).toBeDefined()
    expect(pkg.dependencies['@theokit/sdk']).toBeDefined() // agent runtime kept
    expect(pkg.dependencies['@theokit/ui']).toBeUndefined() // web-only dropped
    // The tui's RENDER is ai-free (App.tsx imports no `ai`; see the App content assertions above), but `ai`
    // stays DECLARED because theokit's in-process agent runtime (`streamAgentTurnInProcess`) imports it.
    expect(pkg.dependencies.ai).toBeDefined()
    expect(pkg.scripts.dev).toContain('tui/main.tsx')
    expect(pkg.scripts['demo:tools']).toBe('tsx tui/tool-variations.tsx')

    expect(existsSync(join(targetDir, 'app'))).toBe(false) // web UI removed
    expect(existsSync(join(targetDir, 'tui/App.tsx.tmpl'))).toBe(false) // no leftover .tmpl

    // tsconfig include points at the surface source (so `tsc` type-checks the entry files).
    const tsconfig = JSON.parse(read('tsconfig.json')) as { include: string[] }
    expect(tsconfig.include).toContain('tui/**/*.tsx')
    expect(tsconfig.include.some((g) => g.startsWith('app/'))).toBe(false)
  })

  it('desktop scaffolds a Tauri app: sidecar + src-tauri + React webview on @theokit/ui + @theokit/tauri', () => {
    scaffold(targetDir, 'my-desk')
    applySurface({ targetDir, projectName: 'my-desk', surface: 'desktop' })

    // Three tiers (ADR-0045): webview / Rust shell / Node sidecar.
    expect(existsSync(join(targetDir, 'sidecar/sidecar.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'sidecar/sidecar-core.ts'))).toBe(false) // M47 — replaced by @theokit/tauri/sidecar
    expect(existsSync(join(targetDir, 'src-tauri/Cargo.toml'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/tauri.conf.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/src/lib.rs'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/capabilities/default.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'frontend/index.html'))).toBe(true)
    expect(existsSync(join(targetDir, 'frontend/src/main.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'frontend/src/App.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'frontend/src/main.ts'))).toBe(false) // M47 — React entry now

    // M47 — the webview is React + @theokit/ui, driven by useAgent over @theokit/tauri's ChannelTransport.
    const app = read('frontend/src/App.tsx')
    expect(app).toContain("from '@theokit/ui'")
    expect(app).toContain('ChatThread')
    expect(app).toContain('useAgent')
    expect(app).toContain('ChannelTransport')
    expect(app).toContain('createTauriChannelSource')
    expect(read('frontend/src/main.tsx')).toContain("import '@theokit/ui/styles.css'")

    // Parity with the web default surface — the SAME rich @theokit/ui components (not a bare input/button),
    // just a different transport. Guards against regressing the desktop back to a poorer chat.
    expect(app).toContain('ChatComposer')
    expect(app).toContain('AgentStreaming')
    expect(app).toContain('QuickActionChips')
    expect(app).toContain('AgentErrorCard')
    expect(app).toContain('ThemeSwitcher')

    // The sidecar runs the turn via @theokit/tauri/sidecar (no hand-rolled copy).
    expect(read('sidecar/sidecar.ts')).toContain("from '@theokit/tauri/sidecar'")

    // {{name}} substituted in the Rust + Tauri config.
    expect(read('src-tauri/Cargo.toml')).toContain('my-desk-desktop')
    expect(read('src-tauri/tauri.conf.json')).toContain('my-desk')

    expect(existsSync(join(targetDir, 'app'))).toBe(false) // web UI removed
    expect(existsSync(join(targetDir, 'src-tauri/Cargo.toml.tmpl'))).toBe(false) // no leftover .tmpl

    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@theokit/ui']).toBeDefined() // M47 renders the webview
    expect(pkg.dependencies['@theokit/tauri']).toBeDefined() // M47 transport source + sidecar
    expect(pkg.dependencies['@usetheo/ui']).toBeDefined() // rich surface parity — Button
    expect(pkg.dependencies['lucide-react']).toBeDefined() // rich surface parity — icons

    // tsconfig include covers the sidecar + React webview source (not the removed app/).
    const tsconfig = JSON.parse(read('tsconfig.json')) as { include: string[] }
    expect(tsconfig.include).toContain('sidecar/**/*.ts')
    expect(tsconfig.include).toContain('frontend/src/**/*.tsx')
    expect(tsconfig.include.some((g) => g.startsWith('app/'))).toBe(false)

    // Window/bundle icons ship — `tauri::generate_context!()` fails to compile without icons/icon.png.
    expect(existsSync(join(targetDir, 'src-tauri/icons/icon.png'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/icons/icon.ico'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/icons/icon.icns'))).toBe(true)

    // The sidecar externalBin launcher generator ships, is wired into `build:sidecar`, and runs before
    // dev/build so `src-tauri/binaries/theo-sidecar-<triple>` exists when the Rust shell spawns it.
    expect(existsSync(join(targetDir, 'scripts/build-sidecar.mjs'))).toBe(true)
    const pkgScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts
    expect(pkgScripts['build:sidecar']).toBe('node scripts/build-sidecar.mjs')
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
      build: { beforeDevCommand: string; beforeBuildCommand: string }
      bundle: { icon: string[] }
      app: { withGlobalTauri?: boolean; security: { csp: string | null } }
    }
    expect(conf.build.beforeDevCommand).toContain('scripts/build-sidecar.mjs')
    expect(conf.build.beforeBuildCommand).toContain('scripts/build-sidecar.mjs')
    expect(conf.bundle.icon).toContain('icons/icon.ico')

    // White-screen guards: App.tsx reads `globalThis.__TAURI__.core` at module scope, so the global
    // MUST be injected (`withGlobalTauri`) or React never mounts. And the Vite dev server injects an
    // inline react-refresh script that a strict `script-src 'self'` CSP blocks → blank webview; the
    // scaffold ships `csp: null` (harden for production per README § Packaging).
    expect(conf.app.withGlobalTauri).toBe(true)
    expect(conf.app.security.csp).toBeNull()
  })

  it('throws on a forced transform error (EC-4 rollback parity with --bare)', () => {
    scaffold(targetDir, 'app')
    expect(() =>
      applySurface({ targetDir, projectName: 'app', surface: 'tui', _testForceError: 'boom' }),
    ).toThrow(/Forced surface failure/)
  })
})
