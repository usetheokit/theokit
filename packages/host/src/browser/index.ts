import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { McpServerConfig } from '@theokit/sdk'

import { HostError } from '../host-error.js'

export { createSharedBrowser, launchChromium } from './shared-browser.js'
export type { BrowserLauncher, LaunchedBrowser, SharedBrowser } from './shared-browser.js'

/** The tool that runs model-written JavaScript in the server process; it is denied whatever `deny` says. */
export const UNSAFE_BROWSER_TOOL = 'browser_run_code_unsafe'

interface BrowserMcpServerBase {
  /** More tool names to leave out; `browser_run_code_unsafe` is always left out. */
  readonly deny?: readonly string[]
  /**
   * An absolute directory the server writes its files into (screenshots, snapshots, downloads).
   * The caller owns it and its contents stay after the server exits. Default: a fresh temporary
   * directory, removed when the server exits.
   */
  readonly outputDir?: string
}

export interface IsolatedBrowserOptions extends BrowserMcpServerBase {
  /** Headless Chromium on a fresh profile per session. */
  readonly mode: 'isolated'
}

export interface SharedBrowserOptions extends BrowserMcpServerBase {
  /** Attach to a browser several sessions share; each session works in a tab of its own. */
  readonly mode: 'shared'
  /** The CDP endpoint `createSharedBrowser().start()` resolves to. */
  readonly cdpEndpoint: string
}

export type BrowserMcpServerOptions = IsolatedBrowserOptions | SharedBrowserOptions

/** What the tests inject. */
export interface BrowserMcpServerDeps {
  readonly resolveCli?: () => string
  /** The proxy script to run; default the one shipped next to this module. */
  readonly proxyPath?: string
}

const ISOLATED_PLAYWRIGHT_CONFIG = JSON.stringify({
  browser: {
    browserName: 'chromium',
    launchOptions: { channel: 'chromium-headless-shell', chromiumSandbox: false },
  },
})

function defaultResolveCli(): string {
  const manifestPath = createRequire(import.meta.url).resolve('@playwright/mcp/package.json')
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { readonly bin?: unknown }
  const entry =
    typeof bin === 'string'
      ? bin
      : (bin as Readonly<Record<string, unknown>> | undefined)?.['playwright-mcp']
  if (typeof entry !== 'string')
    throw new HostError('browser_no_cli', `${manifestPath} declares no playwright-mcp bin`)
  return join(dirname(manifestPath), entry)
}

/**
 * The stdio MCP server config for a browser the agent drives (Playwright MCP). The server runs behind
 * a proxy that leaves `browser_run_code_unsafe` and the `deny` tools out of the tool list, refuses
 * calls to them, confines the server's files to `outputDir`, and inlines page snapshots. Calls run
 * one at a time.
 *
 * The proxy and Playwright's output-directory setting are not an operating-system sandbox: tools such
 * as `browser_evaluate` still run page-side JavaScript, and the browser reaches the network.
 */
export function browserMcpServer(
  options: BrowserMcpServerOptions,
  deps: BrowserMcpServerDeps = {},
): McpServerConfig {
  if (options.outputDir !== undefined && !isAbsolute(options.outputDir)) {
    throw new HostError(
      'browser_output_dir',
      `outputDir must be an absolute path, got "${options.outputDir}"`,
    )
  }
  if (options.mode === 'shared' && options.cdpEndpoint === '') {
    throw new HostError(
      'browser_cdp_endpoint',
      'shared mode needs the cdpEndpoint of a started shared browser',
    )
  }
  const cliPath = (deps.resolveCli ?? defaultResolveCli)()
  const proxyPath = deps.proxyPath ?? fileURLToPath(new URL('./proxy-entry.js', import.meta.url))
  const proxyArgs: string[] = []
  if (options.outputDir !== undefined) proxyArgs.push('--output-dir', options.outputDir)
  for (const name of options.deny ?? []) proxyArgs.push('--deny', name)
  const serverArgs =
    options.mode === 'shared'
      ? ['--cdp-endpoint', options.cdpEndpoint]
      : ['--headless', '--isolated']
  if (options.mode === 'isolated') proxyArgs.push('--playwright-config', ISOLATED_PLAYWRIGHT_CONFIG)
  return {
    type: 'stdio',
    command: process.execPath,
    args: [proxyPath, ...proxyArgs, '--', cliPath, ...serverArgs],
    // One step's calls run in the order listed: a wait or snapshot must not run while a navigate loads.
    sequential: true,
  }
}
