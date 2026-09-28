/**
 * Where the app goes inside the built client shell, for a target that renders the document itself.
 *
 * Extracted from `cloudflare.ts` on 2026-09-28 (B-317), when the Vercel target gained a document branch
 * and needed the same knowledge. One adapter importing another is the coupling `deployed-baked-routes.ts`
 * was extracted to avoid, and this is the second instance of that shape rather than a new one.
 *
 * It THROWS rather than degrading, in both directions, and the messages say what to do. A target that
 * renders a document with no `<head>` and no client entry produces a page that loads nothing and reports
 * no error — the failure this refuses to ship.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { findRootDiv } from '../core/contracts/find-root-div.js'

export function readDocumentShell(
  cwd: string,
  streaming: boolean,
): { htmlHead?: string; htmlTail?: string } {
  if (!streaming) return {}

  const indexPath = resolve(cwd, '.theokit/client/index.html')
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a constant suffix under the caller's project root
  if (!existsSync(indexPath)) {
    throw new Error(
      `[adapter-cloudflare] ssrStreaming is on but ${indexPath} does not exist, so the worker ` +
        `would serve a document with no <head> and no client entry. Run the client build first, ` +
        `or set ssrStreaming: false in theo.config.ts.`,
    )
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the same path, proven above
  const indexHtml = readFileSync(indexPath, 'utf-8')
  const rootDiv = findRootDiv(indexHtml)
  if (rootDiv === undefined) {
    throw new Error(
      `[adapter-cloudflare] ${indexPath} has no <div id="root">, so the streamed document has ` +
        `nowhere to put the app. Add one, or set ssrStreaming: false in theo.config.ts.`,
    )
  }

  return {
    htmlHead: indexHtml.slice(0, rootDiv.insertAt),
    htmlTail: indexHtml.slice(rootDiv.insertAt),
  }
}
