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

import {
  generateAgentsDts,
  generateAgentsRuntimeModule,
} from '../../packages/theo/src/vite-plugin/agents-typed-client.js'
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

  it('test_M41_emits_both_name_and_transport_overloads', () => {
    // M41 (ADR-0050 D6) — the codegen keeps the name-typed overload AND adds a transport overload,
    // so the SAME generated `useAgent` binds web (by name) and terminal/desktop (by AgentTransport).
    const dts = generateAgentsDts({
      manifest: manifestWith([
        { filePath: 'agents/support.ts', agentPath: '/api/agents/support', name: 'support' },
      ]),
      dtsOutPath: DTS_OUT,
      projectRoot: PROJECT_ROOT,
    })
    // The AgentTransport seam type is imported from theokit/client (M47 adds AgentHandle to the import).
    expect(dts).toContain(
      `import type { UseAgentReturn, AgentTransport, AgentHandle } from 'theokit/client'`,
    )
    // Overload 1 — by name (typed input + tools).
    expect(dts).toContain(`useAgent<K extends keyof AppAgents>(`)
    // Overload 2 — by transport (InProcessTransport etc.).
    expect(dts).toContain(`transport: AgentTransport,`)
    expect(dts).toContain(`): UseAgentReturn<TInput>`)
  })

  it('test_M47_emits_named_handle_and_handle_overload', () => {
    // M47 (ADR-M47-2) — the codegen also emits one client-safe handle const per agent + a useAgent(handle)
    // overload, so `import { chat } from '@theo/agents'; useAgent(chat)` kills the magic string + dup type.
    const dts = generateAgentsDts({
      manifest: manifestWith([
        { filePath: 'agents/chat.ts', agentPath: '/api/agents/chat', name: 'chat' },
      ]),
      dtsOutPath: DTS_OUT,
      projectRoot: PROJECT_ROOT,
    })
    // Named handle const, typed with the agent's phantom input + tools.
    expect(dts).toContain(
      `export const chat: AgentHandle<InferAgentInput<_agent_chat>, InferAgentToolNames<_agent_chat>>`,
    )
    // useAgent(handle) overload.
    expect(dts).toContain(`handle: AgentHandle<TInput, TTools>,`)
    expect(dts).toContain(`): UseAgentReturn<TInput, TTools>`)
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

describe('generateAgentsRuntimeModule (M47 — the runtime `@theo/agents` body)', () => {
  it('test_agentHandle_is_imported_not_reexported (regression: browser ReferenceError)', () => {
    // The runtime module USES `agentHandle(...)` to build each handle, so it must be `import`ed (a local
    // binding), NOT `export {...} from` (a re-export with no local binding). `export { agentHandle } from`
    // shipped a `ReferenceError: agentHandle is not defined` in the browser — this pins the fix.
    const mod = generateAgentsRuntimeModule(['chat'])
    expect(mod).toContain(`import { agentHandle } from 'theokit/client'`)
    expect(mod).toContain(`export { useAgent } from 'theokit/client'`)
    // The buggy form must NOT reappear: agentHandle re-exported (no local binding) while also called.
    expect(mod).not.toContain(`export { useAgent, agentHandle }`)
    expect(mod).toContain(`export const chat = agentHandle('/api/agents/chat')`)
  })

  it('test_empty_manifest_still_exports_useAgent', () => {
    const mod = generateAgentsRuntimeModule([])
    expect(mod).toContain(`export { useAgent } from 'theokit/client'`)
    expect(mod).not.toContain('agentHandle(')
  })

  it('test_emits_one_handle_per_agent', () => {
    const mod = generateAgentsRuntimeModule(['chat', 'support'])
    expect(mod).toContain(`export const chat = agentHandle('/api/agents/chat')`)
    expect(mod).toContain(`export const support = agentHandle('/api/agents/support')`)
  })
})
