/** The WebChat URL space: every path the routes serve and the dispatch sends to them, spelled once. */

export const WEBCHAT_ROUTE = '/webchat'
/** Where the page posts a chat message; `web/agent-options.ts` spells it for the browser, tied by a test. */
export const WEBCHAT_CHAT_PATH = `${WEBCHAT_ROUTE}/chat`
/** The sandboxed frame that runs an html widget; the page posts the markup to it. */
export const WEBCHAT_SANDBOX_PATH = `${WEBCHAT_ROUTE}/sandbox`
export const WEBCHAT_ASSETS_PREFIX = `${WEBCHAT_ROUTE}/assets/`

/** `/webchat` itself or anything under `/webchat/`, and not `/webchatx` (EC-4). */
export function isWebchatPath(pathname: string): boolean {
  return pathname === WEBCHAT_ROUTE || pathname.startsWith(`${WEBCHAT_ROUTE}/`)
}
