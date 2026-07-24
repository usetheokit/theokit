import { describe, expect, it } from 'vitest'

/**
 * M58 — the layered boundary `SDK → Theokit → AgentBuilder`. `@theokit/agents` re-exports (pass-through)
 * the 5 already-OO / pure SDK domains so the consumer imports them from the Theokit layer, not from
 * `@theokit/sdk*` directly. This test LOCKS each barrel's surface: if a re-export is dropped in a
 * refactor, the consumer's import silently breaks — this fails loudly instead.
 *
 * Runtime `typeof` checks cover the VALUE exports (classes / functions). The type-only exports
 * (`SandboxBackend`, `InteractiveBackend`, `StartInteractiveOptions`, `SDKAgent`, `CustomTool`,
 * `SessionRecord`) have no runtime footprint; they are locked by the type-import lines at the top of
 * this file — if any were dropped from the barrel, `tsc` would fail to compile this file.
 */
import type { SDKAgent, CustomTool, SessionRecord } from '../../src/index.js'
import type { SandboxBackend, SandboxConfig } from '../../src/sandbox-entry.js'
import type {
  InteractiveBackend,
  StartInteractiveOptions,
  StartInteractiveResult,
} from '../../src/interactive-entry.js'

// Force the type-only imports to be "used" so `noUnusedLocals`/lint do not strip them — the whole
// point is that these type names resolve through the barrel.
type _TypeSurface = [
  SDKAgent,
  CustomTool,
  SessionRecord,
  SandboxBackend,
  SandboxConfig,
  InteractiveBackend,
  StartInteractiveOptions,
  StartInteractiveResult,
]

describe('M58 — @theokit/agents pass-through barrels for the 5 already-OO/pure SDK domains', () => {
  it('core: Agent / Squad / Tool / Provider reach the main barrel', async () => {
    const m = await import('../../src/index.js')
    for (const name of ['Agent', 'Squad', 'Tool', 'Provider'] as const) {
      expect(m[name], name).toBeTypeOf('function')
    }
    // The SDK's `X.create()` shape survives the pass-through (not wrapped).
    expect(m.Tool.create).toBeTypeOf('function')
    expect(m.Agent.create).toBeTypeOf('function')
  })

  it('sandbox: LocalSandbox reaches @theokit/agents/sandbox', async () => {
    const m = await import('../../src/sandbox-entry.js')
    expect(m.LocalSandbox).toBeTypeOf('function')
  })

  it('persistence: the pure path/IO helpers reach @theokit/agents/persistence', async () => {
    const m = await import('../../src/persistence-entry.js')
    for (const name of ['transcriptPath', 'encodeProjectDir', 'atomicWriteText'] as const) {
      expect(m[name], name).toBeTypeOf('function')
    }
  })

  it('pty: PtyInteractiveBackend reaches @theokit/agents/pty', async () => {
    const m = await import('../../src/pty-entry.js')
    expect(m.PtyInteractiveBackend).toBeTypeOf('function')
  })

  it('interactive: the module resolves (its surface is type-only; locked by the type imports above)', async () => {
    const m = await import('../../src/interactive-entry.js')
    expect(m).toBeTypeOf('object')
  })
})
