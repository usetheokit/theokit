import { describe, it, expect } from 'vitest'

/**
 * server/internal-api.ts is the EXPLICIT internal contract that `server/`
 * exposes to its build-time consumers (vite-plugin, cli) — distinct from the
 * PUBLIC `server/index.ts` barrel (`theokit/server`). It exists so those
 * consumers stop coupling to server's internal file layout
 * (architecture-report cleanup Step 4 / architecture.md Invariant 3).
 *
 * This test asserts the contract re-exports the required symbols AND that the
 * re-exported reference is identical to the source module's export (a barrel
 * that re-exports a DIFFERENT object would be a silent contract break).
 */
describe('server/internal-api contract', () => {
  it('test_server_internal_api_reexports_required_value_symbols', async () => {
    const api = await import('../../packages/theo/src/server/internal-api.js')
    for (const name of [
      'executeRoute',
      'executeAction',
      'sendError',
      'matchRoute',
      'scanServerRoutes',
      'scanServerActions',
      'createViteLoader',
      'logRequest',
      'findSuggestion',
      'createCorsHandler',
      'applySecurityHeaders',
      'handleBatchRequest',
      'generateManifest',
      'generateNonce',
      'scanWebSocketRoutes',
    ]) {
      expect(
        typeof (api as Record<string, unknown>)[name],
        `internal-api must re-export ${name}`,
      ).toBe('function')
    }
  })

  it('test_server_internal_api_reexport_is_same_ref_as_source', async () => {
    const api = await import('../../packages/theo/src/server/internal-api.js')
    const execute = await import('../../packages/theo/src/server/http/execute.js')
    const match = await import('../../packages/theo/src/server/scan/match.js')
    expect((api as { executeRoute: unknown }).executeRoute).toBe(execute.executeRoute)
    expect((api as { sendError: unknown }).sendError).toBe(execute.sendError)
    expect((api as { matchRoute: unknown }).matchRoute).toBe(match.matchRoute)
  })
})
