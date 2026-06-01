/**
 * RED tests for T3.1 — vite-plugin/actions-virtual-module.ts
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 3 / T3.1 + ADR D4.
 * Vite plugin that resolves `@theo/actions` virtual module and emits a Proxy
 * facade that calls `theoFetch('/_actions/<name>', body)`.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { actionsVirtualModule } from '../../packages/theo/src/vite-plugin/actions-virtual-module.js'

let serverDir: string

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'theokit-actions-vm-'))
  serverDir = join(root, 'server')
  mkdirSync(join(serverDir, 'actions'), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(serverDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

function write(file: string, contents: string): void {
  const full = join(serverDir, 'actions', file)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents)
}

function mockContext(): { environment: { name: string } } {
  return { environment: { name: 'client' } }
}

describe('actionsVirtualModule — resolveId', () => {
  it('should resolve @theo/actions to internal resolved id', async () => {
    const plugin = actionsVirtualModule({ serverDir })
    const resolveHandler = getResolveHandler(plugin)
    const out = resolveHandler('@theo/actions')
    expect(out).toBe('\0@theo/actions')
  })

  it('should ignore unrelated ids', async () => {
    const plugin = actionsVirtualModule({ serverDir })
    const resolveHandler = getResolveHandler(plugin)
    const out = resolveHandler('react')
    expect(out).toBeUndefined()
  })
})

describe('actionsVirtualModule — load', () => {
  it('should emit empty proxy when actions/ dir empty', async () => {
    const plugin = actionsVirtualModule({ serverDir })
    const loadHandler = getLoadHandler(plugin)
    const out = await loadHandler.call(mockContext(), '\0@theo/actions')
    expect(typeof out === 'string' ? out : out?.code).toContain('actions')
    expect(typeof out === 'string' ? out : out?.code).toContain('{}')
  })

  it('should emit actions object with entries for each scanned file', async () => {
    write(
      'createUser.ts',
      `
      import { z } from 'zod'
      import { defineAction } from 'theokit/server'
      export default defineAction({
        input: z.object({ name: z.string() }),
        handler: ({ input }) => ({ id: '1', name: input.name }),
      })
    `,
    )
    write(
      'deleteUser.ts',
      `
      export default defineAction({ input: z.object({}), handler: () => null })
    `,
    )
    const plugin = actionsVirtualModule({ serverDir })
    const loadHandler = getLoadHandler(plugin)
    const out = await loadHandler.call(mockContext(), '\0@theo/actions')
    const code = typeof out === 'string' ? out : (out?.code ?? '')
    expect(code).toContain('createUser')
    expect(code).toContain('deleteUser')
    expect(code).toContain('/_actions/createUser')
    expect(code).toContain('/_actions/deleteUser')
  })

  it('should NOT load on non-virtual id', async () => {
    const plugin = actionsVirtualModule({ serverDir })
    const loadHandler = getLoadHandler(plugin)
    const out = await loadHandler.call(mockContext(), '\0react')
    expect(out).toBeUndefined()
  })
})

describe('actionsVirtualModule — plugin shape', () => {
  it('should declare enforce=pre and a name', () => {
    const plugin = actionsVirtualModule({ serverDir })
    expect(plugin.name).toBe('theo:actions-virtual-module')
    expect(plugin.enforce).toBe('pre')
  })
})

// Helpers to access vite's filter-shaped resolve/load handlers.
// Tests intentionally call handlers with the runtime shape Vite uses
// (single-arg resolveId, bound `this` context for load); Rollup's strict
// PluginContext type is irrelevant to the contract under test, so handlers
// are exposed via a loose signature.
type LooseResolve = (id: string) => string | undefined | null
type LoadResult = string | { code: string } | undefined | null
type LooseLoad = (
  this: { environment: { name: string } },
  id: string,
) => Promise<LoadResult> | LoadResult
function getResolveHandler(plugin: ReturnType<typeof actionsVirtualModule>): LooseResolve {
  const r = plugin.resolveId
  if (typeof r === 'function') return r as unknown as LooseResolve
  if (r && 'handler' in r && typeof r.handler === 'function')
    return r.handler as unknown as LooseResolve
  throw new Error('plugin.resolveId not a function or handler-shape')
}

function getLoadHandler(plugin: ReturnType<typeof actionsVirtualModule>): LooseLoad {
  const l = plugin.load
  if (typeof l === 'function') return l as unknown as LooseLoad
  if (l && 'handler' in l && typeof l.handler === 'function')
    return l.handler as unknown as LooseLoad
  throw new Error('plugin.load not a function or handler-shape')
}
