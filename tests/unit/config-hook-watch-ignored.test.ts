import { describe, it, expect } from 'vitest'

import { runConfigHook } from '../../packages/theo/src/vite-plugin/config-hook.js'

/**
 * #121 — a local SQLite DB (`.data/app.db` + its `-wal`/`-shm` sidecars) is
 * written on every request that touches the DB (agent turns, conversations…).
 * If the Vite dev watcher sees those writes it fires a full page reload — the
 * screen "blinks" and any in-flight agent stream is torn down. The dev config
 * must ignore the DB artifacts + theokit's own `.theokit/` output.
 */
describe('runConfigHook — server.watch.ignored (#121)', () => {
  const cfg = runConfigHook({
    projectRoot: '/tmp/x',
    theoSrcDir: '/tmp/theo',
    services: undefined,
    optimizeDepsInclude: [],
  })
  const ignored = (cfg.server as { watch: { ignored: string[] } }).watch.ignored

  it('ignores the local SQLite data dir + WAL/SHM sidecars (no reload on DB writes)', () => {
    expect(ignored).toContain('**/.data/**')
    expect(ignored.some((p) => p.includes('db-wal'))).toBe(true)
    expect(ignored.some((p) => p.includes('db-shm'))).toBe(true)
  })

  it("ignores theokit's own .theokit output dir (no self-triggered reload)", () => {
    expect(ignored).toContain('**/.theokit/**')
  })

  it('has no duplicate ignore entries', () => {
    expect(new Set(ignored).size).toBe(ignored.length)
  })
})
