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
import type { SDKAgent, CustomTool, SessionRecord, DiagnosticsSink } from '../../src/index.js'
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
  DiagnosticsSink,
  CustomTool,
  SessionRecord,
  SandboxBackend,
  SandboxConfig,
  InteractiveBackend,
  StartInteractiveOptions,
  StartInteractiveResult,
]

/**
 * M79 — the barrel is imported at MODULE SCOPE, not inside the test.
 *
 * It costs ~1.5 s to load (M78 fattened it with `export *` from five SDK subpaths), and an
 * `await import()` inside the test body pays that cost INSIDE vitest's 5 s budget. On its own it
 * passed; in the full suite, under contention, it blew — and the message was "Test timed out", which
 * says nothing about the cause being module loading.
 *
 * The trigger was M79 moving the `@theokit/sdk*` packages from peer to dependency, which changes
 * pnpm's resolution path. But the defect predates it: module-loading cost does not belong in the
 * budget of a test that only checks the shape of what was loaded. At module scope, it is paid during
 * collection.
 */
const barrel = await import('../../src/index.js')

describe('M58 — @theokit/agents pass-through barrels for the 5 already-OO/pure SDK domains', () => {
  it('core: Agent / Squad / Tool / Provider reach the main barrel', () => {
    const m = barrel
    for (const name of ['Agent', 'Squad', 'Tool', 'Provider'] as const) {
      expect(m[name], name).toBeTypeOf('function')
    }
    // The SDK's `X.create()` shape survives the pass-through (not wrapped).
    expect(m.Tool.create).toBeTypeOf('function')
    expect(m.Agent.create).toBeTypeOf('function')
  })

  it('theokit#173 — setDiagnosticsSink reaches the main barrel', () => {
    // The SDK owns the channel; the consumer must be able to INSTALL a sink without importing
    // `@theokit/sdk` directly, because a layered consumer forbids exactly that import.
    //
    // The cost of the gap is measured, not hypothetical: theokit-sdk#165 chased the wrong hypothesis
    // for a 429 because the retry was unobservable, and the SDK fix that made it observable
    // (`8323f1f38`) could not reach a consumer that had no way to install the sink receiving it.
    expect(barrel.setDiagnosticsSink).toBeTypeOf('function')
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

  it('pty: the backend moved to @theokit/agents-pty; the subpath stays as a signpost (#460)', async () => {
    // Asserted as an absence rather than deleted, because the absence is the point: this entry made
    // every web application compile a terminal, and a barrel test that simply stopped mentioning it
    // would let it drift back in without anything objecting.
    //
    // Its surface did not shrink — `packages/agents-pty/tests/unit/surface.test.ts` carries the same
    // six symbols and asserts they are the upstream identities, not a wrapper.
    const manifest = (await import('../../package.json', { with: { type: 'json' } })).default as {
      exports?: Record<string, unknown>
      dependencies?: Record<string, string>
    }
    // The SUBPATH stays — it resolves to a stub that explains the move, so an upgrading consumer
    // gets a sentence rather than ERR_MODULE_NOT_FOUND on a specifier that worked yesterday.
    expect(
      manifest.exports?.['./pty'],
      '`./pty` must keep resolving, for the migration',
    ).toBeDefined()
    // The DEPENDENCY is what must never come back: it is the native install step every application
    // was paying for, and a shim that re-imported it would undo the change it is shimming.
    expect(
      manifest.dependencies?.['@theokit/sdk-pty'],
      'a native install step must not return to every consumer of this package',
    ).toBeUndefined()
  })

  it('interactive: the module resolves (its surface is type-only; locked by the type imports above)', async () => {
    const m = await import('../../src/interactive-entry.js')
    expect(m).toBeTypeOf('object')
  })
})

describe('M63 — the last pass-through re-exports that close the zero-`@theokit/sdk*` boundary', () => {
  it('a2a: SubAgent reaches the main barrel with its `.create()` shape intact', async () => {
    const m = await import('../../src/index.js')
    expect(m.SubAgent, 'SubAgent').toBeTypeOf('function')
    expect(m.SubAgent.create, 'SubAgent.create').toBeTypeOf('function')
  })

  it('path-safety: the pure guard helpers reach the main barrel', async () => {
    const m = await import('../../src/index.js')
    for (const name of ['assertNoSymlinkEscape', 'isForbiddenPath', 'safePathJoin'] as const) {
      expect(m[name], name).toBeTypeOf('function')
    }
  })
})
