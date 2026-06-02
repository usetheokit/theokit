/**
 * Regression — Actions tab silently stopped showing entries after
 * commit c7906fa (Requests body-preview enrichment) because the Overlay's
 * useInsertionEffect cleanup unconditionally clears
 * `window.__theoDevtoolsDispatcher`. In StrictMode / HMR re-mount, the
 * ordering can leave the global undefined while a follow-up call to
 * `actions.<name>(input)` reads `window.__theoDevtoolsDispatcher` — sees
 * undefined — and silently drops the telemetry.
 *
 * Root-cause invariant under test:
 *   The global pointer is a stable handle to a module singleton. Once
 *   any mount installs it, it must REMAIN set for the lifetime of the
 *   page. Cleanup of one mount must NEVER tear down the global out from
 *   under a still-mounted (or about-to-mount) sibling tree.
 *
 * Test simulates the install / cleanup / install dance and asserts the
 * window global is preserved.
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { dispatcher } from '../../packages/theo/src/devtools/dispatcher.js'
import { installDispatcherGlobal } from '../../packages/theo/src/devtools/install-global.js'

type WithGlobal = typeof globalThis & {
  window?: { __theoDevtoolsDispatcher?: unknown }
}

function ensureWindow(): { __theoDevtoolsDispatcher?: unknown } {
  const g = globalThis as WithGlobal
  if (!g.window) g.window = {}
  return g.window
}

describe('window.__theoDevtoolsDispatcher — stable global pointer', () => {
  beforeEach(() => {
    const w = ensureWindow()
    delete w.__theoDevtoolsDispatcher
  })

  afterEach(() => {
    const w = ensureWindow()
    delete w.__theoDevtoolsDispatcher
  })

  it('installs the dispatcher singleton on first call', () => {
    installDispatcherGlobal()
    const w = ensureWindow()
    expect(w.__theoDevtoolsDispatcher).toBe(dispatcher)
  })

  it('survives a StrictMode double-invoke pattern (install → cleanup → install)', () => {
    // Mount A
    const cleanupA = installDispatcherGlobal()
    expect(ensureWindow().__theoDevtoolsDispatcher).toBe(dispatcher)

    // StrictMode unmount A
    cleanupA()
    // After cleanup, the GLOBAL POINTER must still be set — the dispatcher
    // is a module singleton with no lifecycle. Tearing the pointer down
    // would race with sibling mounts and silently drop telemetry.
    expect(ensureWindow().__theoDevtoolsDispatcher).toBe(dispatcher)

    // Mount B (StrictMode re-mount)
    const cleanupB = installDispatcherGlobal()
    expect(ensureWindow().__theoDevtoolsDispatcher).toBe(dispatcher)

    // Final unmount
    cleanupB()
    expect(ensureWindow().__theoDevtoolsDispatcher).toBe(dispatcher)
  })

  it('cleanup is safe to call multiple times', () => {
    const cleanup = installDispatcherGlobal()
    cleanup()
    cleanup()
    expect(ensureWindow().__theoDevtoolsDispatcher).toBe(dispatcher)
  })

  it('no-ops when window is undefined (SSR safety)', () => {
    const g = globalThis as WithGlobal
    const savedWindow = g.window
    delete g.window
    try {
      expect(() => {
        const cleanup = installDispatcherGlobal()
        cleanup()
      }).not.toThrow()
    } finally {
      g.window = savedWindow
    }
  })
})
