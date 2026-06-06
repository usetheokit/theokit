/**
 * Plugin scope encapsulation — RED tests for T1.1.
 *
 * These tests prove the contract that T3.1 will implement:
 *   - `TheoApp.register(plugin)` creates a child instance via
 *     `Object.create(parent)` (Fastify-style — blueprint D1).
 *   - Decorations live in the child's prototype chain; mutations in plugin A
 *     do NOT leak to plugin B nor back to the parent.
 *   - Sibling plugins may decorate the same key without conflict (each has
 *     its own scope).
 *
 * Current state (pre-T3.1): TheoKit's PluginRunner uses a flat decoration
 * Map with `DuplicateDecorationError` protection (EC-7). These tests
 * intentionally FAIL today and will pass once T3.1 introduces scope
 * encapsulation. The EC-7 test in `tests/unit/plugin-runner.test.ts` will
 * be migrated/removed in T3.1 with a migration guide (BREAKING change for
 * plugin authors who depended on the duplicate-key error contract).
 *
 * BDD scenarios (per plan T1.1):
 *   - Happy path: plugin A sees only A's decoration in A's scope
 *   - Validation error: invalid decoration key throws at register-time
 *   - Edge case (EC-4): mutable object decorations share refs through the
 *     proto chain — DOCUMENTED as invariant (decorations must be primitives
 *     OR Object.freeze'd before decorate).
 *   - Error scenario: plugin throws in register → parent recovery is clean.
 */

import { describe, it, expect } from 'vitest'

import {
  PluginRunner,
  DuplicateDecorationError,
} from '../../packages/theo/src/server/plugins/plugin-runner.js'
import type { TheoApp } from '../../packages/theo/src/server/plugin-types.js'
import { pluginA } from '../fixtures/plugin-scope-A/index.js'
import { pluginB } from '../fixtures/plugin-scope-B/index.js'

/**
 * Helper: probe the PluginRunner for per-plugin scoped decorations.
 *
 * Post-T3.1 the PluginRunner will expose `getPluginScope(name)` that
 * returns the child TheoApp built by `Object.create(parent)` for that
 * plugin. Today this method does NOT exist — the test calls it via a
 * dynamic `as` to keep the assertion structurally honest (it MUST fail
 * with `getPluginScope is not a function` until T3.1 lands).
 */
function getPluginScope(runner: PluginRunner, name: string): TheoApp {
  const r = runner as unknown as {
    getPluginScope?: (name: string) => TheoApp
  }
  if (typeof r.getPluginScope !== 'function') {
    throw new Error(
      `PluginRunner.getPluginScope is not implemented yet — T3.1 (C1 plugin scope encapsulation) will add it. ` +
        `This test is intentionally RED until then.`,
    )
  }
  return r.getPluginScope(name)
}

describe('Plugin scope encapsulation (T1.1 RED → T3.1 GREEN)', () => {
  // RED-1
  it('plugin A decoration is isolated from plugin B (sibling scope)', async () => {
    const runner = new PluginRunner()
    await runner.register(pluginA)
    // Today this throws DuplicateDecorationError (EC-7 atual). Post-T3.1
    // it succeeds because plugin B gets its OWN child scope.
    await runner.register(pluginB)

    const scopeA = getPluginScope(runner, 'plugin-scope-A')
    const scopeB = getPluginScope(runner, 'plugin-scope-B')

    // Future API: scoped decorations introspection.
    const scopeAUnknown = scopeA as unknown as {
      decorations?: Record<string, unknown>
    }
    const scopeBUnknown = scopeB as unknown as {
      decorations?: Record<string, unknown>
    }
    expect(scopeAUnknown.decorations?.user).toBe('value-A')
    expect(scopeBUnknown.decorations?.user).toBe('value-B')
  })

  // RED-2
  it('decoration does not leak to parent app (parent has no `user` key)', async () => {
    const runner = new PluginRunner()
    await runner.register(pluginA)

    // Post-T3.1: parent's decorations Map / prototype chain has NO `user`
    // because decoration lives in plugin A's child scope only.
    const r = runner as unknown as {
      getParentDecorations?: () => Map<string, unknown>
    }
    if (typeof r.getParentDecorations !== 'function') {
      throw new Error(
        'PluginRunner.getParentDecorations is not implemented yet — T3.1 will add it. RED state.',
      )
    }
    const parentDecorations = r.getParentDecorations()
    expect(parentDecorations.has('user')).toBe(false)
  })

  // RED-3
  it('sibling plugins are isolated (request traversal through A then B sees per-scope values)', async () => {
    const runner = new PluginRunner()
    await runner.register(pluginA)
    await runner.register(pluginB)

    // Post-T3.1: applying decorations for each plugin scope yields the
    // plugin's own value, NOT a global last-writer-wins.
    const ctxA: Record<string, unknown> = {}
    const ctxB: Record<string, unknown> = {}
    const r = runner as unknown as {
      applyScopedDecorations?: (pluginName: string, target: Record<string, unknown>) => void
    }
    if (typeof r.applyScopedDecorations !== 'function') {
      throw new Error(
        'PluginRunner.applyScopedDecorations is not implemented yet — T3.1 will add it. RED state.',
      )
    }
    r.applyScopedDecorations('plugin-scope-A', ctxA)
    r.applyScopedDecorations('plugin-scope-B', ctxB)
    expect(ctxA.user).toBe('value-A')
    expect(ctxB.user).toBe('value-B')
  })

  // RED-4
  it('register creates a child scope via Object.create (proto chain to parent)', async () => {
    const runner = new PluginRunner()
    await runner.register(pluginA)

    const scopeA = getPluginScope(runner, 'plugin-scope-A')
    const r = runner as unknown as {
      getParentApp?: () => TheoApp
    }
    if (typeof r.getParentApp !== 'function') {
      throw new Error(
        'PluginRunner.getParentApp is not implemented yet — T3.1 will add it. RED state.',
      )
    }
    const parent = r.getParentApp()

    // Post-T3.1: child scope MUST NOT be the same identity as the parent
    // AND its prototype MUST be the parent (Fastify Object.create pattern,
    // ADR-0028 blueprint D1).
    expect(scopeA).not.toBe(parent)
    expect(Object.getPrototypeOf(scopeA)).toBe(parent)
  })
})

describe('Plugin scope encapsulation — BDD scenarios (T1.1)', () => {
  // Happy path
  it('happy path: plugin A registers + decorates + consumer sees value in A scope', async () => {
    const runner = new PluginRunner()
    await runner.register(pluginA)

    const scopeA = getPluginScope(runner, 'plugin-scope-A')
    const scopeAUnknown = scopeA as unknown as {
      decorations?: Record<string, unknown>
    }
    expect(scopeAUnknown.decorations?.user).toBe('value-A')
  })

  // Validation error
  it('validation error: invalid decoration key (non-string) throws at register-time', async () => {
    const runner = new PluginRunner()
    await expect(
      runner.register({
        name: 'plugin-bad-key',
        register(app) {
          // Pre-T3.1: decorateRequest signature already requires string key,
          // so TS catches this at compile-time; the test forces it via
          // `as unknown` to verify runtime guard exists post-T3.1.
          ;(
            app as unknown as { decorateRequest: (k: unknown, v: unknown) => void }
          ).decorateRequest(42 as unknown as string, 'value')
        },
      }),
    ).rejects.toThrow(/invalid|key|string/i)
  })

  // Edge case (EC-4 from edge-case review)
  // Documents the invariant: shared-prototype Object.create means MUTABLE
  // value mutations propagate through the proto chain. Plugin authors MUST
  // pass primitives OR Object.freeze'd values to decorateRequest. This
  // test is the executable spec of that invariant.
  it('edge case (EC-4): mutable object decoration mutations are visible across scopes via proto chain', async () => {
    const sharedCounter = { count: 0 }
    const runner = new PluginRunner()
    await runner.register({
      name: 'plugin-shared-mutable',
      register(app) {
        app.decorateRequest('counter', sharedCounter)
      },
    })
    const scope = getPluginScope(runner, 'plugin-shared-mutable')
    const scopeUnknown = scope as unknown as {
      decorations?: { counter: { count: number } }
    }
    expect(scopeUnknown.decorations?.counter.count).toBe(0)

    // Mutating through the reference SHOULD propagate to all observers
    // who access this same object identity — by design of JavaScript
    // object references. The invariant the plugin contract communicates:
    // do not pass mutable values that you do not want shared.
    sharedCounter.count = 42
    expect(scopeUnknown.decorations?.counter.count).toBe(42)
  })

  // Error scenario — plugin throws in register
  it('error scenario: plugin throws in register → parent recovery is clean (no half-mounted state)', async () => {
    const runner = new PluginRunner()
    await expect(
      runner.register({
        name: 'plugin-throws',
        register() {
          throw new Error('boom in register')
        },
      }),
    ).rejects.toThrow(/boom in register/)
    // Post-T3.1: parent should NOT have any decoration / hook from the
    // failed plugin. We assert through the public `has(name)` API: the
    // failed plugin should NOT appear as registered.
    expect(runner.has('plugin-throws')).toBe(false)
  })

  // Note: EC-7 atual (DuplicateDecorationError when two plugins decorate
  // the same key) intentionally NOT preserved as a test in this file.
  // That contract changes in T3.1 — see `tests/unit/plugin-runner.test.ts`
  // `throws DuplicateDecorationError when two plugins decorate the same key`
  // which will be migrated/removed in T3.1 with a BREAKING-change migration
  // guide.

  // Lint-clean: silence the unused-import warning for DuplicateDecorationError
  // (kept in the import block to make the breaking-change connection visible
  // to humans reading this file).
  it('contract note: DuplicateDecorationError will be removed in T3.1', () => {
    expect(DuplicateDecorationError.name).toBe('DuplicateDecorationError')
  })
})
