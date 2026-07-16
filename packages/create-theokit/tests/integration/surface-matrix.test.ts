/**
 * M45 — exhaustive scenario matrix for `--surface`. Runs EVERY scenario through the same code path the
 * CLI uses (`scaffold` + `applySurface` + `parseSurfaceFlags` + `scaffoldServices`) and deep-asserts the
 * generated tree, deps, scripts, tsconfig, and unified-client wiring. Also PERSISTS one tui + one desktop
 * app to the scratchpad (`THEOKIT_SCRATCH`) for the out-of-band real `npm install` + `tsc` validation.
 */
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scaffold } from '../../src/index.js'
import { parseBackendFlags, scaffoldServices } from '../../src/scaffold-services.js'
import { applySurface, parseSurfaceFlags } from '../../src/scaffold-surface.js'

describe('M45 surface matrix — parseSurfaceFlags (all forms)', () => {
  it('covers default, both syntaxes, explicit web, invalid, and value-less', () => {
    expect(parseSurfaceFlags([])).toBe('web')
    expect(parseSurfaceFlags(['--surface', 'tui'])).toBe('tui')
    expect(parseSurfaceFlags(['--surface=tui'])).toBe('tui')
    expect(parseSurfaceFlags(['--surface', 'desktop'])).toBe('desktop')
    expect(parseSurfaceFlags(['--surface=desktop'])).toBe('desktop')
    expect(parseSurfaceFlags(['--surface=web'])).toBe('web')
    expect(parseSurfaceFlags(['app', '--yes', '--surface=tui'])).toBe('tui') // mixed with other args
    expect(() => parseSurfaceFlags(['--surface=mobile'])).toThrow(
      /unknown --surface value: 'mobile'/,
    )
    expect(() => parseSurfaceFlags(['--surface=ios'])).toThrow(/Valid options: web, tui, desktop/)
  })
})

describe('M45 surface matrix — full scaffold per surface', () => {
  let dir: string
  beforeEach(() => {
    dir = join(tmpdir(), `m45-matrix-${randomUUID()}`)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const read = (p: string): string => readFileSync(join(dir, p), 'utf-8')
  const pkg = (): {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    scripts: Record<string, string>
  } => JSON.parse(read('package.json'))
  const has = (p: string): boolean => existsSync(join(dir, p))
  const noTmplLeftover = (): boolean => {
    // walk the tree; assert nothing ends with .tmpl
    const walk = (d: string): string[] => {
      const out: string[] = []
      for (const e of readdirSync(d)) {
        const full = join(d, e)
        if (statSync(full).isDirectory()) out.push(...walk(full))
        else if (e.endsWith('.tmpl')) out.push(full)
      }
      return out
    }
    return walk(dir).length === 0
  }

  it('web — no-op: keeps the web app, adds no surface files', () => {
    scaffold(dir, 'web-app')
    applySurface({ targetDir: dir, projectName: 'web-app', surface: 'web' })
    expect(has('app')).toBe(true)
    expect(has('tui')).toBe(false)
    expect(has('sidecar')).toBe(false)
    expect(pkg().dependencies.theokit).toBeDefined()
  })

  it('tui — Ink app on the unified client, web UI dropped, deps + tsconfig correct', () => {
    scaffold(dir, 'term-app')
    applySurface({ targetDir: dir, projectName: 'term-app', surface: 'tui' })

    // Tree
    expect(has('tui/main.tsx')).toBe(true)
    expect(has('tui/App.tsx')).toBe(true)
    expect(has('README-surface.md')).toBe(true)
    expect(has('agents/chat.ts')).toBe(true) // agent kept
    expect(has('app')).toBe(false) // web UI removed
    expect(has('index.html')).toBe(false)
    expect(noTmplLeftover()).toBe(true)

    // Unified-client wiring (ADR-0054 D2) + Claude-Code render via @theokit/tui + {{name}}
    const app = read('tui/App.tsx')
    for (const s of [
      'useAgent',
      'InProcessTransport',
      'streamAgentTurnInProcess',
      'term-app',
      // Claude-Code render: <AgentTimeline> (Markdown + tool cards) fed by the ai-free `messagesToAgentEvents`
      "from '@theokit/tui'",
      'AgentTimeline',
      'messagesToAgentEvents',
    ]) {
      expect(app).toContain(s)
    }
    // NOT the old text-only path, and the app source never imports `ai` directly.
    expect(app).not.toContain('ChatThread')
    expect(app).not.toContain("from '@theokit/tui/ai-sdk'")
    expect(app).not.toContain("from 'ai'")
    expect(read('tui/main.tsx')).toContain("from './App.js'")

    // Deps: @theokit/tui + ink + ai added, agent runtime + theokit peers kept, UI-only removed
    const p = pkg()
    expect(p.dependencies['@theokit/tui']).toBeDefined() // renders the conversation
    expect(p.dependencies.ink).toBeDefined()
    expect(p.dependencies.figlet).toBeDefined() // @theokit/tui banner peer (pnpm never auto-installs peers)
    expect(p.dependencies.lowlight).toBeDefined() // @theokit/tui code-highlight peer
    expect(p.dependencies.ai).toBeDefined() // theokit's in-process agent runtime imports it (render is ai-free)
    expect(p.dependencies['@theokit/sdk']).toBeDefined()
    expect(p.dependencies['@theokit/agents']).toBeDefined()
    expect(p.dependencies.react).toBeDefined()
    expect(p.dependencies['react-router']).toBeDefined() // theokit REQUIRED peer — must stay
    expect(p.dependencies.zod).toBeDefined() // theokit REQUIRED peer
    expect(p.dependencies['@theokit/ui']).toBeUndefined() // UI-only dropped
    expect(p.dependencies['@usetheo/ui']).toBeUndefined()
    expect(p.dependencies['lucide-react']).toBeUndefined()
    expect(p.devDependencies.tailwindcss).toBeUndefined()
    expect(p.scripts.dev).toBe('tsx tui/main.tsx')

    // tsconfig points at the surface source
    const tsc = JSON.parse(read('tsconfig.json')) as { include: string[] }
    expect(tsc.include).toContain('tui/**/*.tsx')
    expect(tsc.include.every((g) => !g.startsWith('app/'))).toBe(true)
  })

  it('desktop — three tiers on the unified client, Rust + Tauri config coherent', () => {
    scaffold(dir, 'desk-app')
    applySurface({ targetDir: dir, projectName: 'desk-app', surface: 'desktop' })

    // Tier files (M47: React webview + @theokit/tauri sidecar — no hand-rolled sidecar-core.ts)
    for (const f of [
      'sidecar/sidecar.ts',
      'frontend/index.html',
      'frontend/src/main.tsx',
      'frontend/src/App.tsx',
      'frontend/vite.config.ts',
      'src-tauri/Cargo.toml',
      'src-tauri/tauri.conf.json',
      'src-tauri/src/lib.rs',
      'src-tauri/src/main.rs',
      'src-tauri/build.rs',
      'src-tauri/capabilities/default.json',
    ]) {
      expect(has(f), `missing ${f}`).toBe(true)
    }
    expect(has('sidecar/sidecar-core.ts')).toBe(false) // M47 — replaced by @theokit/tauri/sidecar
    expect(has('frontend/src/main.ts')).toBe(false) // M47 — React main.tsx now
    expect(has('app')).toBe(false)
    expect(noTmplLeftover()).toBe(true)

    // Webview = React + @theokit/ui, driven by useAgent over @theokit/tauri's ChannelTransport (M47)
    const app = read('frontend/src/App.tsx')
    for (const s of [
      'useAgent',
      'ChannelTransport',
      "from '@theokit/ui'",
      'ChatThread',
      'ChatMessage',
      'createTauriChannelSource',
      "from '@theokit/tauri'",
      'desk-app', // {{name}} substituted
    ]) {
      expect(app).toContain(s)
    }
    expect(read('frontend/src/main.tsx')).toContain("import '@theokit/ui/styles.css'")
    // Sidecar = @theokit/tauri/sidecar (no hand-rolled copy)
    expect(read('sidecar/sidecar.ts')).toContain("from '@theokit/tauri/sidecar'")
    expect(read('sidecar/sidecar.ts')).toContain('runTurnToJsonl')
    // Rust shell has both commands + externalBin wiring
    const lib = read('src-tauri/src/lib.rs')
    expect(lib).toContain('fn run_turn')
    expect(lib).toContain('fn approve')
    expect(lib).toContain('Channel<String>')
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
      build: { frontendDist: string }
      bundle: { externalBin: string[] }
    }
    expect(conf.build.frontendDist).toContain('frontend')
    expect(conf.bundle.externalBin).toContain('binaries/theo-sidecar')
    // {{name}} substituted in Rust + conf
    expect(read('src-tauri/Cargo.toml')).toContain('name = "desk-app-desktop"')
    expect(conf).toMatchObject({ productName: 'desk-app' })

    // Deps + tsconfig
    const p = pkg()
    expect(p.dependencies.ai).toBeDefined() // webview UIMessageStream reader
    expect(p.dependencies['@theokit/ui']).toBeDefined() // M47 — renders the webview
    expect(p.dependencies['@theokit/tauri']).toBeDefined() // M47 — transport source + sidecar glue
    expect(p.dependencies.react).toBeDefined() // React webview
    expect(p.dependencies['react-router']).toBeDefined() // theokit REQUIRED peer kept
    expect(p.devDependencies['@tauri-apps/cli']).toBeDefined()
    expect(p.devDependencies.vite).toBeDefined()
    expect(p.devDependencies['@vitejs/plugin-react']).toBeDefined() // M47 — compiles the webview JSX
    expect(p.scripts.dev).toBe('tauri dev')
    const tsc = JSON.parse(read('tsconfig.json')) as { include: string[] }
    expect(tsc.include).toContain('sidecar/**/*.ts')
    expect(tsc.include).toContain('frontend/src/**/*.tsx')
  })

  it('tui + --backend node — surface AND services compose', () => {
    scaffold(dir, 'combo-app')
    applySurface({ targetDir: dir, projectName: 'combo-app', surface: 'tui' })
    const backends = parseBackendFlags(['--backend', 'node'])
    scaffoldServices({ targetDir: dir, projectName: 'combo-app', backends })

    expect(has('tui/App.tsx')).toBe(true) // surface
    expect(has('services/worker')).toBe(true) // service
    expect(pkg().dependencies.ink).toBeDefined()
  })

  it("forced transform error throws (EC-4 rollback is the caller's job)", () => {
    scaffold(dir, 'x')
    expect(() =>
      applySurface({
        targetDir: dir,
        projectName: 'x',
        surface: 'desktop',
        _testForceError: 'disk',
      }),
    ).toThrow(/Forced surface failure: disk/)
  })
})

describe('M45 surface matrix — persist apps for out-of-band npm install + tsc', () => {
  it('writes a tui + desktop app to THEOKIT_SCRATCH when set', () => {
    const scratch = process.env.THEOKIT_SCRATCH
    if (!scratch) {
      expect(true).toBe(true) // no scratch requested — skip persistence
      return
    }
    for (const surface of ['tui', 'desktop'] as const) {
      const out = join(scratch, `gen-${surface}`)
      rmSync(out, { recursive: true, force: true })
      mkdirSync(scratch, { recursive: true })
      // scaffold into a temp then move into the persistent scratch (scaffold refuses an existing dir).
      const tmp = join(tmpdir(), `persist-${surface}-${randomUUID()}`)
      scaffold(tmp, `gen-${surface}`)
      applySurface({ targetDir: tmp, projectName: `gen-${surface}`, surface })
      cpSync(tmp, out, { recursive: true })
      rmSync(tmp, { recursive: true, force: true })
      expect(existsSync(join(out, 'package.json'))).toBe(true)
    }
  })
})
