import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * M45 (ADR-0054) — `create-theokit --surface web|tui|desktop`.
 *
 * A FLAG-driven additive scaffold (mirrors `--backend` / `scaffoldServices`), NOT a new top-level
 * template (ADR-0023 default-only respected). `web` is the default (the existing web app — no-op).
 * `tui` / `desktop` copy a template fragment (`templates/surfaces/<kind>/`) onto the scaffolded default,
 * mutate `package.json` (drop web-only deps, add surface deps + scripts), and remove the web UI. Each
 * scaffolded surface consumes the agent via the M41/M42/M44 UNIFIED client (ADR-0054 D2), not the raw
 * seam. All Tauri/Ink boilerplate lives HERE in the scaffolder templates — framework core stays agnostic.
 */
export type SurfaceKind = 'web' | 'tui' | 'desktop'

const VALID_SURFACES = ['web', 'tui', 'desktop'] as const

/**
 * Web-only deps dropped for the tui/desktop surfaces (they ship no web UI). `react-router` is NOT dropped
 * — `theokit` declares it a REQUIRED peer, so removing it breaks `npm install` (ERESOLVE).
 */
const WEB_ONLY_DEPS = ['@theokit/ui', '@usetheo/ui', 'lucide-react'] as const
const WEB_ONLY_DEV_DEPS = ['tailwindcss', '@tailwindcss/vite', 'tailwindcss-animate'] as const
/** Web UI files removed for the tui/desktop surfaces. */
const WEB_ONLY_FILES = ['app', 'index.html', 'tailwind.config.ts', 'postcss.config.js'] as const

interface SurfaceConfig {
  /** The template fragment dir under `templates/surfaces/`. */
  fragment: string
  /** Deps ADDED for this surface. */
  deps: Record<string, string>
  /** Dev deps ADDED for this surface. */
  devDeps: Record<string, string>
  /** Scripts SET for this surface (override the web dev/build). */
  scripts: Record<string, string>
  /** `tsconfig.json` `include` for this surface (the default's `app/**` is removed with the web UI). */
  tsconfigInclude: string[]
}

const SURFACE_CONFIG: Record<Exclude<SurfaceKind, 'web'>, SurfaceConfig> = {
  tui: {
    fragment: 'tui',
    // `ai` is the UIMessageStream type/reader the unified client consumes; it was transitive via
    // `@theokit/ui` (dropped for tui), so declare it explicitly. `ink` peers `react >=18` (works with 19).
    deps: { ink: '^5.1.0', ai: '^7.0.0' },
    devDeps: { tsx: '^4.19.0' },
    scripts: { dev: 'tsx tui/main.tsx', start: 'tsx tui/main.tsx' },
    tsconfigInclude: ['tui/**/*.ts', 'tui/**/*.tsx', 'server/**/*.ts', 'agents/**/*.ts'],
  },
  desktop: {
    fragment: 'desktop',
    // The webview consumes the agent via `createAgentClient` from the React-FREE `theokit/client/core`
    // (M44). It is bundled by Vite; the sidecar runs via tsx. `ai` = the UIMessageStream reader (was
    // transitive via `@theokit/ui`, dropped here).
    deps: { ai: '^7.0.0' },
    devDeps: { tsx: '^4.19.0', '@tauri-apps/cli': '^2.0.0', vite: '^6.0.0' },
    scripts: {
      dev: 'tauri dev',
      tauri: 'tauri',
      'build:frontend': 'vite build frontend',
      'build:sidecar':
        'tsx --version >/dev/null && echo "sidecar runs via tsx (see src-tauri/tauri.conf.json)"',
    },
    tsconfigInclude: [
      'sidecar/**/*.ts',
      'frontend/src/**/*.ts',
      'server/**/*.ts',
      'agents/**/*.ts',
    ],
  },
}

/** Parse `--surface <kind>` / `--surface=<kind>`; default `web`. Fail-fast on an unknown value. */
export function parseSurfaceFlags(args: string[]): SurfaceKind {
  let surface: SurfaceKind = 'web'
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    let value: string | undefined
    if (a === '--surface') {
      value = args[i + 1]
      i++
    } else if (a.startsWith('--surface=')) {
      value = a.slice('--surface='.length)
    }
    if (value === undefined) continue
    if (!(VALID_SURFACES as readonly string[]).includes(value)) {
      throw new Error(
        `unknown --surface value: '${value}'. Valid options: ${VALID_SURFACES.join(', ')}.`,
      )
    }
    surface = value as SurfaceKind
  }
  return surface
}

/** Locate the fragment dir shipped alongside the compiled scaffolder. */
function getSurfaceFragmentDir(fragment: string): string {
  return resolve(__dirname, '../templates/surfaces', fragment)
}

/** Recursively substitute `{{name}}` in `.tmpl` files (mirrors scaffoldServices). */
function substituteTmpls(dir: string, projectName: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      substituteTmpls(full, projectName)
      continue
    }
    if (entry.endsWith('.tmpl')) {
      const content = readFileSync(full, 'utf-8').replace(/\{\{name\}\}/g, projectName)
      writeFileSync(full.replace(/\.tmpl$/, ''), content)
      unlinkSync(full)
    }
  }
}

export interface ApplySurfaceOptions {
  targetDir: string
  projectName: string
  surface: SurfaceKind
  /** Test-only: force a failure to exercise the caller's rollback (mirrors --bare `_testForceError`). */
  _testForceError?: string
}

interface PartialPackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
  [key: string]: unknown
}

/**
 * Apply a surface onto a freshly-scaffolded default template. `web` is a no-op (the default IS web).
 * `tui`/`desktop` copy the fragment, drop web-only deps + UI, and add the surface's deps/scripts. Throws
 * on any failure so the CLI can roll the whole target dir back (EC-4), exactly like `--bare`.
 */
export function applySurface(options: ApplySurfaceOptions): void {
  if (options._testForceError !== undefined) {
    throw new Error(`Forced surface failure: ${options._testForceError}`)
  }
  if (options.surface === 'web') return

  const cfg = SURFACE_CONFIG[options.surface]
  const src = getSurfaceFragmentDir(cfg.fragment)
  if (!existsSync(src)) {
    throw new Error(`surface fragment not found: ${src}`)
  }

  // 1. Copy the fragment onto the target, then substitute {{name}}.
  cpSync(src, options.targetDir, { recursive: true })
  substituteTmpls(options.targetDir, options.projectName)

  // 2. Remove the web UI (a tui/desktop app ships no web surface).
  for (const rel of WEB_ONLY_FILES) {
    const p = join(options.targetDir, rel)
    if (existsSync(p)) rmSync(p, { recursive: true, force: true })
  }

  // 3. Mutate package.json: drop web-only deps, add surface deps + scripts.
  const pkgPath = join(options.targetDir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PartialPackageJson
    pkg.dependencies = { ...dropKeys(pkg.dependencies, WEB_ONLY_DEPS), ...cfg.deps }
    pkg.devDependencies = { ...dropKeys(pkg.devDependencies, WEB_ONLY_DEV_DEPS), ...cfg.devDeps }
    pkg.scripts = { ...(pkg.scripts ?? {}), ...cfg.scripts }
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  // 4. Point `tsconfig.json` `include` at the surface's source (the default's `app/**` went with the web
  // UI) — so `tsc` in the generated project type-checks the surface entry files (the unified-client wiring).
  const tsconfigPath = join(options.targetDir, 'tsconfig.json')
  if (existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8')) as { include?: string[] }
    tsconfig.include = cfg.tsconfigInclude
    writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)
  }
}

/** Return a copy of `record` without `keys` (no dynamic `delete` — filter-rebuild). */
function dropKeys(
  record: Record<string, string> | undefined,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(Object.entries(record ?? {}).filter(([k]) => !keys.includes(k)))
}
