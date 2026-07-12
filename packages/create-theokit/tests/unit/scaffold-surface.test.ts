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

    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(pkg.dependencies.ink).toBeDefined()
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

  it('desktop scaffolds a Tauri app: sidecar + src-tauri + webview on createAgentClient(ChannelTransport)', () => {
    scaffold(targetDir, 'my-desk')
    applySurface({ targetDir, projectName: 'my-desk', surface: 'desktop' })

    // Three tiers (ADR-0045): webview / Rust shell / Node sidecar.
    expect(existsSync(join(targetDir, 'sidecar/sidecar.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'sidecar/sidecar-core.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/Cargo.toml'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/tauri.conf.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/src/lib.rs'))).toBe(true)
    expect(existsSync(join(targetDir, 'src-tauri/capabilities/default.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'frontend/index.html'))).toBe(true)
    expect(existsSync(join(targetDir, 'frontend/src/main.ts'))).toBe(true)

    // ADR-0054 D2 — the webview uses the React-FREE unified client (M42 + M44).
    const webview = read('frontend/src/main.ts')
    expect(webview).toContain('createAgentClient')
    expect(webview).toContain('ChannelTransport')
    expect(webview).toContain('theokit/client/core')

    // The sidecar keeps the M35/M36 server seam.
    expect(read('sidecar/sidecar-core.ts')).toContain('streamAgentTurnInProcess')

    // {{name}} substituted in the Rust + Tauri config.
    expect(read('src-tauri/Cargo.toml')).toContain('my-desk-desktop')
    expect(read('src-tauri/tauri.conf.json')).toContain('my-desk')

    expect(existsSync(join(targetDir, 'app'))).toBe(false) // web UI removed
    expect(existsSync(join(targetDir, 'src-tauri/Cargo.toml.tmpl'))).toBe(false) // no leftover .tmpl

    // tsconfig include covers the sidecar + webview source (not the removed app/).
    const tsconfig = JSON.parse(read('tsconfig.json')) as { include: string[] }
    expect(tsconfig.include).toContain('sidecar/**/*.ts')
    expect(tsconfig.include).toContain('frontend/src/**/*.ts')
    expect(tsconfig.include.some((g) => g.startsWith('app/'))).toBe(false)
  })

  it('throws on a forced transform error (EC-4 rollback parity with --bare)', () => {
    scaffold(targetDir, 'app')
    expect(() =>
      applySurface({ targetDir, projectName: 'app', surface: 'tui', _testForceError: 'boom' }),
    ).toThrow(/Forced surface failure/)
  })
})
