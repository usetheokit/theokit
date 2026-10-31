import { describe, expect, it } from 'vitest'

import { WEBCHAT_API } from '../web/agent-options.js'
import { renderPage, WEBCHAT_ASSETS } from '../src/webchat/page.js'
import { isWebchatPath, WEBCHAT_ASSETS_PREFIX, WEBCHAT_CHAT_PATH, WEBCHAT_ROUTE } from '../src/webchat/paths.js'

describe('the WebChat URL space, spelled once', () => {
  it('derives the chat path and the assets prefix from the route', () => {
    expect(WEBCHAT_CHAT_PATH).toBe(`${WEBCHAT_ROUTE}/chat`)
    expect(WEBCHAT_ASSETS_PREFIX).toBe(`${WEBCHAT_ROUTE}/assets/`)
  })

  it('posts from the page to the path the server serves the chat on', () => {
    // `web/` cannot import `src/` (its own tsconfig), so this test is the tie between the two.
    expect(WEBCHAT_API).toBe(WEBCHAT_CHAT_PATH)
  })

  it('links the page to every asset the routes serve, under the assets prefix', () => {
    const html = renderPage()
    for (const name of Object.keys(WEBCHAT_ASSETS)) expect(html).toContain(`"${WEBCHAT_ASSETS_PREFIX}${name}"`)
  })

  it('matches the route itself and paths under it, and not a longer name (EC-4)', () => {
    expect(isWebchatPath(WEBCHAT_ROUTE)).toBe(true)
    expect(isWebchatPath(WEBCHAT_CHAT_PATH)).toBe(true)
    expect(isWebchatPath(`${WEBCHAT_ASSETS_PREFIX}app.js`)).toBe(true)
    expect(isWebchatPath(`${WEBCHAT_ROUTE}x`)).toBe(false)
    expect(isWebchatPath('/health')).toBe(false)
  })
})
