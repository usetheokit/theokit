import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { McpServerConfig } from '@theokit/sdk'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** What the browser server is started from, resolved once at start. */
export interface BrowserSettings {
  /** The `playwright-mcp` CLI of the pinned `@playwright/mcp`. */
  readonly cliPath: string
}

/** What the tests inject; the process passes nothing. */
export interface BrowserDeps {
  readonly resolveCli?: () => string
  /** Where Playwright keeps its browsers. Default: `PLAYWRIGHT_BROWSERS_PATH`, else `~/.cache/ms-playwright`. */
  readonly browsersDir?: string
}

type Env = Readonly<Record<string, string | undefined>>

const INSTALL_HINT = 'run `pnpm --filter theoclaw run browser:install`'
/**
 * The wrapper the server runs under (`tools/browser-proxy.mjs`): it leaves `browser_run_code_unsafe`
 * out of the tool list and owns the server's file root. `src/tools` and `dist/tools` are both two
 * levels under the app, so one relative path serves the tests and the built process.
 */
const PROXY_PATH = fileURLToPath(new URL('../../tools/browser-proxy.mjs', import.meta.url))
/** The directory names Playwright gives a Chromium build: the full browser or the headless shell. */
const CHROMIUM_BUILD = /^chromium(_headless_shell)?-\d+$/

/** The CLI path from `@playwright/mcp`'s own `package.json`: the package exports no `cli.js` subpath. */
function defaultResolveCli(): string {
  const manifestPath = createRequire(import.meta.url).resolve('@playwright/mcp/package.json')
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { readonly bin?: unknown }
  const entry = typeof bin === 'string' ? bin : (bin as Readonly<Record<string, unknown>> | undefined)?.['playwright-mcp']
  if (typeof entry !== 'string') {
    throw new TheoClawConfigError(`${manifestPath} declares no playwright-mcp bin`, { variable: 'THEOCLAW_BROWSER' })
  }
  return join(dirname(manifestPath), entry)
}

/** The codes a module that is not installed (or not exposed) raises on resolution. */
const NOT_RESOLVED = new Set(['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'])

function resolveCliOrRefuse(resolveCli: () => string): string {
  try {
    return resolveCli()
  } catch (error) {
    if (!NOT_RESOLVED.has((error as NodeJS.ErrnoException).code ?? '')) throw error
    throw new TheoClawConfigError(`THEOCLAW_BROWSER=on needs @playwright/mcp, which does not resolve; run \`pnpm install\``, {
      variable: 'THEOCLAW_BROWSER',
    })
  }
}

function browsersDirOf(env: Env, deps: BrowserDeps): string {
  if (deps.browsersDir !== undefined) return deps.browsersDir
  const fromEnv = env.PLAYWRIGHT_BROWSERS_PATH?.trim()
  // `0` is Playwright's "inside the package" layout, not a directory named 0; it is not looked up.
  if (fromEnv === '0') {
    throw new TheoClawConfigError(
      `THEOCLAW_BROWSER=on does not support PLAYWRIGHT_BROWSERS_PATH=0 (browsers inside the package); unset it or name a directory`,
      { variable: 'PLAYWRIGHT_BROWSERS_PATH' },
    )
  }
  return fromEnv === undefined || fromEnv === '' ? join(homedir(), '.cache', 'ms-playwright') : fromEnv
}

/** A Chromium build directory in `dir`, followed through symlinks: a dangling one does not count. */
function hasChromium(dir: string): boolean {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    // Absent, or a file: no browser can be launched from it. Anything else (EACCES) is not a
    // missing install, and is raised as it is.
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw error
  }
  return names.some((name) => CHROMIUM_BUILD.test(name) && statSync(join(dir, name), { throwIfNoEntry: false })?.isDirectory() === true)
}

/**
 * `THEOCLAW_BROWSER`: unset or empty is off; `on` resolves the server CLI and checks a Chromium
 * build is installed, refusing the start when either is missing (plan D2); anything else is refused.
 */
export function readBrowser(env: Env, deps: BrowserDeps = {}): BrowserSettings | undefined {
  const value = env.THEOCLAW_BROWSER
  if (value === undefined || value === '') return undefined
  if (value !== 'on') {
    throw new TheoClawConfigError(`THEOCLAW_BROWSER must be "on" or unset, not "${value}"`, { variable: 'THEOCLAW_BROWSER' })
  }
  const cliPath = resolveCliOrRefuse(deps.resolveCli ?? defaultResolveCli)
  const dir = browsersDirOf(env, deps)
  if (!hasChromium(dir)) {
    throw new TheoClawConfigError(`THEOCLAW_BROWSER=on found no Chromium build in ${dir}; ${INSTALL_HINT}`, {
      variable: 'THEOCLAW_BROWSER',
    })
  }
  return { cliPath }
}

/** The start line that says whether the browser is on. */
export function browserLine(settings: BrowserSettings | undefined): string {
  return settings === undefined
    ? 'tools: browser is off (THEOCLAW_BROWSER unset)'
    : 'tools: browser is on (headless chromium, isolated profile)'
}

/**
 * The stdio server a `/control` agent spawns: headless Chromium on a fresh profile per session,
 * started through the wrapper, which offers every default tool but `browser_run_code_unsafe` and
 * runs the server in its own temporary directory (review round 1, F-dom-1, F-dom-2). It carries
 * neither `env` nor `envPolicy`, so the SDK's `inherit-scrubbed` default applies (NFR-004).
 */
export function browserServer(settings: BrowserSettings): McpServerConfig {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [PROXY_PATH, settings.cliPath, '--headless', '--isolated', '--browser', 'chromium'],
  }
}
