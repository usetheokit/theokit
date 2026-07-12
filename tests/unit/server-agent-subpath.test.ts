/**
 * `theokit/server/agent` — the agent-seam sub-path (T2.5). Re-introduced so agent consumers (the TUI /
 * Tauri scaffold templates, `@theokit/tauri`) have a NON-deprecated import path for `streamAgentTurnInProcess`
 * et al. instead of the `theokit/server` umbrella (which logs a one-time deprecation warning on import).
 *
 * This guards two invariants: (1) the barrel exposes the public agent-seam surface, and (2) it stays lossless
 * against the umbrella — every agent symbol the umbrella re-exports is reachable from the sub-path.
 */
import { describe, expect, it } from 'vitest'

import * as subpath from '../../packages/theo/src/server/agent/index.js'

describe('theokit/server/agent sub-path', () => {
  it('exposes the in-process turn seam + the agent-tool/code-mode/webhook/mcp surface', () => {
    // The symbols the scaffold templates + @theokit/tauri import.
    expect(typeof subpath.streamAgentTurnInProcess).toBe('function')
    expect(typeof subpath.InProcessApprovalRequiredError).toBe('function')
    // The rest of the public agent-domain surface, so the sub-path is the domain barrel (not a slice).
    for (const name of [
      'createWorkflowTool',
      'createACPTool',
      'createVendorAgentTool',
      'createCodeMode',
      'handleChannelWebhook',
      'serveMcpStdio',
      'defineAppResource',
    ] as const) {
      expect(typeof subpath[name], name).toBe('function')
    }
  })

  it('is lossless vs the umbrella — every agent symbol the umbrella re-exports is on the sub-path', async () => {
    // Importing the umbrella emits its one-time deprecation warning; swallow it for this assertion.
    const warn = console.warn
    console.warn = () => undefined
    const umbrella = await import('../../packages/theo/src/server/index.js')
    console.warn = warn

    const agentSymbols = Object.keys(subpath)
    expect(agentSymbols.length).toBeGreaterThan(10)
    for (const name of agentSymbols) {
      expect(name in umbrella, `umbrella missing agent symbol ${name}`).toBe(true)
    }
  })
})
