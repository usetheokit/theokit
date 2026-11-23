import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { HostError } from '../host-error.js'

/** What a launched browser gives back: the loopback CDP endpoint and how to stop it. */
export interface LaunchedBrowser {
  readonly endpoint: string
  readonly close: () => Promise<void>
  /** Resolves when the browser ends by itself (a crash, a closed window); absent for a launcher that cannot tell. */
  readonly exited?: Promise<void>
}

/** Starts Chromium on `profileDir`; tests inject one so no browser is needed. */
export type BrowserLauncher = (profileDir: string) => Promise<LaunchedBrowser>

/** One persistent browser, many MCP sessions attached over CDP. */
export interface SharedBrowser {
  /** Launches the browser once; concurrent callers share one launch. A failed launch, or a browser that has exited, is replaced by the next call. Resolves to the CDP endpoint. */
  readonly start: () => Promise<string>
  /** Stops the browser; safe before, during and after `start`. */
  readonly close: () => Promise<void>
}

interface PlaywrightCore {
  readonly chromium: {
    readonly launchPersistentContext: (
      dir: string,
      options: Record<string, unknown>,
    ) => Promise<{
      readonly close: () => Promise<void>
      readonly on: (event: 'close', listener: () => void) => unknown
    }>
  }
}

const PORT_FILE_DEADLINE_MS = 15_000

function readDevToolsPort(profileDir: string): number | undefined {
  try {
    const port = Number(readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8').split('\n')[0])
    return Number.isInteger(port) && port > 0 ? port : undefined
  } catch {
    return undefined
  }
}

/**
 * The default launcher: Playwright's persistent context on `profileDir` (the headless shell build)
 * with a debugging port on loopback chosen by Chromium, read back from the `DevToolsActivePort`
 * file it writes into the profile.
 */
export const launchChromium: BrowserLauncher = async (profileDir) => {
  const manifest = createRequire(import.meta.url).resolve('@playwright/mcp/package.json')
  // playwright-core is the pinned @playwright/mcp's own dependency, so it is resolved from there.
  const core = createRequire(join(dirname(manifest), 'package.json'))(
    'playwright-core',
  ) as PlaywrightCore
  rmSync(join(profileDir, 'DevToolsActivePort'), { force: true })
  const context = await core.chromium.launchPersistentContext(profileDir, {
    headless: true,
    channel: 'chromium-headless-shell',
    chromiumSandbox: false,
    args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
  })
  const close = async (): Promise<void> => {
    await context.close()
  }
  const exited = new Promise<void>((resolve) => {
    context.on('close', () => {
      resolve()
    })
  })
  const deadline = Date.now() + PORT_FILE_DEADLINE_MS
  let port = readDevToolsPort(profileDir)
  while (port === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    port = readDevToolsPort(profileDir)
  }
  if (port === undefined) {
    await close().catch(() => undefined)
    throw new HostError(
      'browser_no_debug_port',
      `Chromium did not open its debugging port for the profile ${profileDir}`,
    )
  }
  return { endpoint: `http://127.0.0.1:${port}`, close, exited }
}

/** A browser on a persistent profile at `profileDir`, launched on first `start()`; the caller closes it. */
export function createSharedBrowser(
  profileDir: string,
  launch: BrowserLauncher = launchChromium,
): SharedBrowser {
  let starting: Promise<LaunchedBrowser> | undefined
  let closed = false
  return {
    start: async () => {
      if (closed) throw new HostError('browser_closed', 'the shared browser is closed')
      if (starting === undefined) {
        mkdirSync(profileDir, { recursive: true, mode: 0o700 })
        const attempt = launch(profileDir)
        starting = attempt
        const forget = (): void => {
          if (starting === attempt) starting = undefined
        }
        // A failed launch, or a browser that ended by itself, must not be handed out again.
        attempt
          .then((browser) => browser.exited ?? new Promise<void>(() => undefined))
          .then(forget, forget)
          .catch(() => undefined)
      }
      return (await starting).endpoint
    },
    close: async () => {
      closed = true
      const pending = starting
      starting = undefined
      if (pending === undefined) return
      const browser = await pending.catch(() => undefined)
      await browser?.close().catch(() => undefined)
    },
  }
}
