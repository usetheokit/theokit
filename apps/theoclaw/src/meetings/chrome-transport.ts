import { createRequire } from 'node:module'

import { TheoClawConfigError } from '../control-plane/errors.js'
import type { MeetingTransport } from './meetings.js'

/** The slice of Playwright's API the transport uses. */
interface Page {
  goto(url: string): Promise<unknown>
  getByRole(
    role: string,
    options: { name: RegExp },
  ): { first(): { click(o?: { timeout: number }): Promise<void> } }
  getByPlaceholder(text: RegExp): {
    first(): { fill(value: string, o?: { timeout: number }): Promise<void> }
  }
  evaluate<T>(fn: () => T): Promise<T>
  waitForTimeout(ms: number): Promise<void>
}
interface Playwright {
  chromium: {
    launch(o: { args: string[] }): Promise<{
      newContext(o: object): Promise<{ newPage(): Promise<Page> }>
      close(): Promise<void>
    }>
  }
}

function loadPlaywright(): Playwright {
  try {
    const mcp = createRequire(import.meta.url).resolve('@playwright/mcp/package.json')
    return createRequire(mcp)('playwright') as Playwright
  } catch {
    throw new TheoClawConfigError(
      'theoclaw meetings needs playwright (from @playwright/mcp); run `pnpm install`',
      { variable: 'THEOCLAW_BROWSER' },
    )
  }
}

const GUEST_NAME = 'TheoClaw notes'

/** Reads the caption rows Meet renders: speaker name and spoken text. */
function readCaptions(): string[][] {
  const rows = document.querySelectorAll('[aria-label="Captions"] > div > div')
  return Array.from(rows).map((row) => [
    row.querySelector('img + div, .NWpY1d')?.textContent ?? 'Speaker',
    row.textContent ?? '',
  ])
}

/** Joins as a guest in headless Chrome, turns on captions and polls them until the meeting ends. */
export function chromeMeetingTransport(
  _env: Readonly<Record<string, string | undefined>>,
): MeetingTransport {
  return {
    async join(url, { maxMs, onLine }) {
      const browser = await loadPlaywright().chromium.launch({
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
      })
      try {
        const page = await (await browser.newContext({ permissions: [] })).newPage()
        await page.goto(url)
        await page
          .getByPlaceholder(/your name/i)
          .first()
          .fill(GUEST_NAME, { timeout: 15_000 })
        await page
          .getByRole('button', { name: /ask to join|join now/i })
          .first()
          .click({ timeout: 15_000 })
        await page
          .getByRole('button', { name: /turn on captions/i })
          .first()
          .click({ timeout: 120_000 })
        const seen = new Set<string>()
        const deadline = Date.now() + maxMs
        while (Date.now() < deadline) {
          for (const [speaker = '', text = ''] of await page.evaluate(readCaptions)) {
            const key = `${speaker}|${text}`
            if (text !== '' && !seen.has(key)) {
              seen.add(key)
              onLine(speaker, text)
            }
          }
          if (
            await page.evaluate(() =>
              /you left the meeting|removed from the meeting/i.test(document.body.innerText),
            )
          )
            break
          await page.waitForTimeout(2000)
        }
      } finally {
        await browser.close()
      }
    },
  }
}
