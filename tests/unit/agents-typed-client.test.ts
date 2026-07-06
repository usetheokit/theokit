/**
 * M2 (theokit-ai-first) — generateAgentsDts: end-to-end typed binding codegen.
 *
 * Emits `.theokit/agents.d.ts` declaring the virtual `@theo/agents` module with an
 * `AppAgents` interface mapping each scanned `agents/<name>.ts` to its request type,
 * inferred from the agent's `defineAgent({ input })` schema via `InferAgentInput` — so
 * `useAgent('support')` is typed with ZERO manual wiring (DoD line 2). An empty manifest
 * emits a stub so `import '@theo/agents'` never fails with "module not found".
 */
import { describe, expect, it } from 'vitest'

import { generateAgentsDts } from '../../packages/theo/src/vite-plugin/agents-typed-client.js'
import type { TheoManifest } from '../../packages/theo/src/server/scan/manifest.js'

const DTS_OUT = '/project/.theokit/agents.d.ts'
const PROJECT_ROOT = '/project'

function manifestWith(agents: TheoManifest['agents']): TheoManifest {
  return { version: 1, generatedAt: 'x', routes: [], actions: [], websockets: [], agents }
}

describe('generateAgentsDts (M2)', () => {
  it('test_maps_each_agent_to_typed_input_binding', () => {
    const dts = generateAgentsDts({
      manifest: manifestWith([
        { filePath: 'agents/support.ts', agentPath: '/api/agents/support', name: 'support' },
        { filePath: 'agents/echo.ts', agentPath: '/api/agents/echo', name: 'echo' },
      ]),
      dtsOutPath: DTS_OUT,
      projectRoot: PROJECT_ROOT,
    })
    expect(dts).toContain(`declare module '@theo/agents'`)
    expect(dts).toContain(
      `import type { InferAgentInput, InferAgentToolNames } from '@theokit/agents'`,
    )
    // Import the agent's default export TYPE, relative from .theokit/ to agents/.
    expect(dts).toContain(`import type _agent_support from '../agents/support'`)
    expect(dts).toContain(`import type _agent_echo from '../agents/echo'`)
    // Each agent → a typed input binding + tool-name union (M8) keyed by name.
    expect(dts).toContain(
      `'support': { input: InferAgentInput<_agent_support>; tools: InferAgentToolNames<_agent_support> }`,
    )
    expect(dts).toContain(
      `'echo': { input: InferAgentInput<_agent_echo>; tools: InferAgentToolNames<_agent_echo> }`,
    )
    expect(dts).toContain(`export interface AppAgents`)
    // M8 — useAgent carries the agent's tool-name union to the client hook return.
    expect(dts).toContain(`UseAgentReturn<AppAgents[K]['input'], AppAgents[K]['tools']>`)
  })

  it('test_empty_manifest_emits_stub_module', () => {
    const dts = generateAgentsDts({
      manifest: manifestWith([]),
      dtsOutPath: DTS_OUT,
      projectRoot: PROJECT_ROOT,
    })
    expect(dts).toContain(`declare module '@theo/agents'`)
    expect(dts).toContain(`export interface AppAgents`)
    // No import lines for a stub.
    expect(dts).not.toContain('import type _agent_')
  })

  it('test_undefined_agents_field_treated_as_empty', () => {
    const dts = generateAgentsDts({
      manifest: { version: 1, generatedAt: 'x', routes: [], actions: [], websockets: [] },
      dtsOutPath: DTS_OUT,
      projectRoot: PROJECT_ROOT,
    })
    expect(dts).toContain(`export interface AppAgents`)
    expect(dts).not.toContain('import type _agent_')
  })
})
