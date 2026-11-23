/** The WebChat page: an HTML shell that loads the bundle `build:web` writes, and where that bundle is. */

import { renderHostedChatShell } from 'theokit/server/http'

import { WEBCHAT_ROUTE } from './paths.js'

/** The assets `build:web` writes, served by name and nothing else (no URL path reaches the file system). */
export const WEBCHAT_ASSETS = {
  'app.js': 'text/javascript; charset=utf-8',
  'app.css': 'text/css; charset=utf-8',
} as const

/**
 * Where `build:web` writes the bundle: `apps/theoclaw/dist/web/assets/`, the same directory from
 * `src/webchat/` under tsx and from `dist/webchat/` once compiled (EC-5).
 */
export const WEBCHAT_ASSETS_DIR = new URL('../../dist/web/assets/', import.meta.url)

/** The page's shell. `main.tsx` mounts the app on `#root` (EC-10). */
export function renderPage(): string {
  return renderHostedChatShell(WEBCHAT_ROUTE, 'TheoClaw')
}
