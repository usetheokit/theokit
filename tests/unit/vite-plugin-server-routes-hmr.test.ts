/**
 * G6 T1.2 — Vite watcher invalidation for `server/routes/**` with 50ms debounce.
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
 *
 * Contract:
 *   1. `configureServer` registers add/change/unlink listeners on the dev
 *      watcher that are scoped to `<serverDir>/routes/**`.
 *   2. Events outside `<serverDir>/routes/**` are ignored.
 *   3. A burst of 10 events within 30 ms collapses to ONE invalidation call
 *      (50 ms debounce per EC-6).
 *   4. Invalidation invokes `moduleGraph.invalidateModule` for every loaded
 *      route module (id is under `<serverDir>/routes/`) + emits a `full-reload`
 *      websocket message so the browser refetches client manifests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'

import { serverRoutesHmrPlugin } from '../../packages/theo/src/vite-plugin/server-routes-hmr.js'

let projectRoot: string
let serverDir: string
let watcher: EventEmitter
let invalidateModule: ReturnType<typeof vi.fn>
let wsSend: ReturnType<typeof vi.fn>
let getModuleById: ReturnType<typeof vi.fn>

interface FakeViteModule {
  id: string
}

beforeEach(() => {
  projectRoot = join(tmpdir(), `theo-g6-hmr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  serverDir = join(projectRoot, 'server')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })

  watcher = new EventEmitter()
  invalidateModule = vi.fn()
  wsSend = vi.fn()
  getModuleById = vi.fn((id: string): FakeViteModule | undefined => ({ id }))

  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(projectRoot, { recursive: true, force: true })
})

function fakeViteDevServer() {
  return {
    watcher,
    moduleGraph: {
      getModuleById,
      invalidateModule,
      idToModuleMap: new Map([
        [join(serverDir, 'routes', 'a.ts'), { id: join(serverDir, 'routes', 'a.ts') }],
        [join(serverDir, 'routes', 'b.ts'), { id: join(serverDir, 'routes', 'b.ts') }],
        [join(projectRoot, 'app', 'page.tsx'), { id: join(projectRoot, 'app', 'page.tsx') }],
      ]),
    },
    ws: { send: wsSend },
  }
}

describe('G6 T1.2 — serverRoutesHmrPlugin', () => {
  it('test_change_under_server_routes_triggers_invalidation_after_debounce', () => {
    const plugin = serverRoutesHmrPlugin({ serverDir })
    expect(typeof plugin.configureServer).toBe('function')
    plugin.configureServer!(fakeViteDevServer() as never)

    watcher.emit('change', join(serverDir, 'routes', 'a.ts'))

    // Before debounce window, nothing fired
    vi.advanceTimersByTime(49)
    expect(invalidateModule).not.toHaveBeenCalled()
    expect(wsSend).not.toHaveBeenCalled()

    // After debounce window, invalidation fires
    vi.advanceTimersByTime(2)
    expect(invalidateModule).toHaveBeenCalled()
    expect(wsSend).toHaveBeenCalledWith({ type: 'full-reload' })
  })

  it('test_event_outside_server_routes_is_ignored', () => {
    const plugin = serverRoutesHmrPlugin({ serverDir })
    plugin.configureServer!(fakeViteDevServer() as never)

    watcher.emit('change', join(projectRoot, 'app', 'page.tsx'))
    watcher.emit('change', join(projectRoot, 'server', 'actions', 'foo.ts'))

    vi.advanceTimersByTime(100)
    expect(invalidateModule).not.toHaveBeenCalled()
    expect(wsSend).not.toHaveBeenCalled()
  })

  it('test_watcher_50ms_debounce_collapses_burst (EC-6)', () => {
    const plugin = serverRoutesHmrPlugin({ serverDir })
    plugin.configureServer!(fakeViteDevServer() as never)

    // 10 file changes within 30 ms — well inside the 50 ms debounce window
    for (let i = 0; i < 10; i++) {
      watcher.emit('change', join(serverDir, 'routes', `r${i}.ts`))
      vi.advanceTimersByTime(3) // 3 ms apart × 10 = 30 ms total
    }

    // Still inside debounce — no fire yet
    expect(wsSend).not.toHaveBeenCalled()

    // Advance past the 50 ms window from the LAST event
    vi.advanceTimersByTime(50)

    // EC-6 contract: exactly ONE invalidation cycle, not 10
    expect(wsSend).toHaveBeenCalledTimes(1)
    expect(wsSend).toHaveBeenCalledWith({ type: 'full-reload' })
  })

  it('test_add_and_unlink_also_trigger_invalidation', () => {
    const plugin = serverRoutesHmrPlugin({ serverDir })
    plugin.configureServer!(fakeViteDevServer() as never)

    watcher.emit('add', join(serverDir, 'routes', 'new.ts'))
    vi.advanceTimersByTime(60)
    expect(wsSend).toHaveBeenCalledTimes(1)

    watcher.emit('unlink', join(serverDir, 'routes', 'old.ts'))
    vi.advanceTimersByTime(60)
    expect(wsSend).toHaveBeenCalledTimes(2)
  })

  it('test_invalidation_targets_only_route_modules_in_graph', () => {
    const plugin = serverRoutesHmrPlugin({ serverDir })
    plugin.configureServer!(fakeViteDevServer() as never)

    watcher.emit('change', join(serverDir, 'routes', 'a.ts'))
    vi.advanceTimersByTime(60)

    // Both route modules invalidated; app/page.tsx untouched
    const invalidatedIds = invalidateModule.mock.calls.map((call) => (call[0] as FakeViteModule).id)
    expect(invalidatedIds).toContain(join(serverDir, 'routes', 'a.ts'))
    expect(invalidatedIds).toContain(join(serverDir, 'routes', 'b.ts'))
    expect(invalidatedIds).not.toContain(join(projectRoot, 'app', 'page.tsx'))
  })
})
