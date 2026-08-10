/**
 * theokit#95 — the configured `serverDir` must also apply to the dev WebSocket scan.
 *
 * #95 was fixed in route-serving, in the typed client, in actions and in HMR, but
 * `vite-plugin/ws-upgrade.ts` kept resolving `resolve(projectRoot, 'server')`. In a project with
 * `serverDir: 'core'`, the HTTP routes started being found and the WebSocket ones did not — which is
 * worse than the original failure, because a partial fix makes the option look like it works.
 *
 * The test observes BEHAVIOUR, not the string: with routes found, the `upgrade` handler is attached
 * to the httpServer; with no routes, the function returns early and nothing is attached. Asserting
 * the path passed to the scanner would test the implementation and stay green if the scanner changed
 * its contract.
 *
 * The `on('upgrade')` happens INSIDE a dynamic `import('ws')` (lazy, so an app without WebSocket does
 * not pay the cost), so the positive assertion needs `vi.waitFor`. The negative one does not: the
 * early return is synchronous, and a `waitFor` there would only hide a late attachment.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { setupWsUpgrade } from '../../packages/theo/src/vite-plugin/ws-upgrade.js'

/** A project with the backend in `core/` (not the canonical `server/`) and a `ws/echo.ts` route. */
function projectWithBackendIn(dirName: string): { projectRoot: string; serverDir: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'theokit-95-'))
  const serverDir = join(projectRoot, dirName)
  mkdirSync(join(serverDir, 'ws'), { recursive: true })
  writeFileSync(join(serverDir, 'ws', 'echo.ts'), 'export default {}\n')
  return { projectRoot, serverDir }
}

function fakeViteServer(): { httpServer: { on: ReturnType<typeof vi.fn> } } {
  return { httpServer: { on: vi.fn() } }
}

describe('setupWsUpgrade honours the configured serverDir (#95)', () => {
  it('attaches the upgrade handler when the ws routes live in the configured serverDir', async () => {
    const { serverDir } = projectWithBackendIn('core')
    const server = fakeViteServer()

    setupWsUpgrade(server as never, serverDir)

    await vi.waitFor(() =>
      expect(server.httpServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function)),
    )
  })

  it('attaches nothing when the serverDir has no ws routes — the early return still holds', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'theokit-95-empty-'))
    const server = fakeViteServer()

    setupWsUpgrade(server as never, join(projectRoot, 'core'))

    expect(server.httpServer.on).not.toHaveBeenCalled()
  })

  it('the canonical `server/` layout keeps working — the fix widens, it does not replace', async () => {
    const { serverDir } = projectWithBackendIn('server')
    const server = fakeViteServer()

    setupWsUpgrade(server as never, serverDir)

    await vi.waitFor(() =>
      expect(server.httpServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function)),
    )
  })
})
