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

    // ADR-0054 D2 — the unified client, NOT the raw seam consumption.
    const app = read('tui/App.tsx')
    expect(app).toContain('InProcessTransport')
    expect(app).toContain('useAgent')
    expect(app).toContain('streamAgentTurnInProcess')
    expect(app).toContain('my-tui') // {{name}} substituted
    // M46: renders with @theokit/tui via the ai-sdk UIMessage adapter (Step A).
    expect(app).toContain("from '@theokit/tui'")
    expect(app).toContain('ChatThread')
    expect(app).toContain('uiMessagesToChatThread')
    // useAgent opens a fresh stream per send (messages = current turn only) — the template MUST accumulate
    // the transcript locally (else the user prompt never shows and turn order misaligns) and open with a
    // greeting so the thread isn't empty.
    expect(app).toContain('setHistory')
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
    expect(pkg.dependencies['@theokit/sdk']).toBeDefined() // agent runtime kept
    expect(pkg.dependencies['@theokit/ui']).toBeUndefined() // web-only dropped
    expect(pkg.scripts.dev).toContain('tui/main.tsx')

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

    // tsconfig include covers the sidecar + React webview source (not the removed app/).
    const tsconfig = JSON.parse(read('tsconfig.json')) as { include: string[] }
    expect(tsconfig.include).toContain('sidecar/**/*.ts')
    expect(tsconfig.include).toContain('frontend/src/**/*.tsx')
    expect(tsconfig.include.some((g) => g.startsWith('app/'))).toBe(false)
  })

  it('throws on a forced transform error (EC-4 rollback parity with --bare)', () => {
    scaffold(targetDir, 'app')
    expect(() =>
      applySurface({ targetDir, projectName: 'app', surface: 'tui', _testForceError: 'boom' }),
    ).toThrow(/Forced surface failure/)
  })
})
