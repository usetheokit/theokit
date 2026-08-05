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
 * M79 — o barril é importado no ESCOPO DO MÓDULO, não dentro do teste.
 *
 * Ele custa ~1,5 s para carregar (o M78 o engordou com `export *` de cinco subpaths do SDK), e um
 * `await import()` dentro do corpo do teste paga esse custo DENTRO do orçamento de 5 s do vitest.
 * Sozinho passava; na suíte completa, sob contenção, estourava — e a mensagem era "Test timed out",
 * que não diz nada sobre a causa ser carga de módulo.
 *
 * O gatilho foi o M79 mover os `@theokit/sdk*` de peer para dependency, o que muda o caminho de
 * resolução do pnpm. Mas o defeito é anterior: custo de carga de módulo não pertence ao orçamento de
 * um teste que só verifica o formato do que foi carregado. No escopo do módulo, ele é pago na coleta.
 */
const barril = await import('../../src/index.js')

describe('M58 — @theokit/agents pass-through barrels for the 5 already-OO/pure SDK domains', () => {
  it('core: Agent / Squad / Tool / Provider reach the main barrel', () => {
    const m = barril
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
    expect(barril.setDiagnosticsSink).toBeTypeOf('function')
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
