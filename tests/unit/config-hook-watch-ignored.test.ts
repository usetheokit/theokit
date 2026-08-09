import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

/**
 * #121, the missing step: the ignores have to REACH the watcher.
 *
 * The test above proves `runConfigHook` produces the list. It does not prove the list survives —
 * `cli/commands/dev.ts` calls `createServer({ server: { ... } })`, and the inline config takes
 * precedence over the plugin's. Today it does not declare `watch`, so Vite's merge preserves the
 * plugin's. The day somebody adds a `watch` there, the fix disappears **silently**: the only symptom
 * is the screen flickering again, and the test above stays green.
 *
 * The check is over the SOURCE because that is where the regression would be born. I tried doing it
 * by merging the two configs with Vite's own `mergeConfig` — more faithful — but `vite` is not
 * resolvable from the root test directory in this pnpm workspace, and hardcoding the deep path
 * (`packages/theo/node_modules/vite`) would be trading one fragility for another.
 */
describe('dev.ts must not overwrite the watch of the plugin (#121)', () => {
  it('the inline config of createServer does not declare server.watch', () => {
    const source = readFileSync(
      resolve(__dirname, '../../packages/theo/src/cli/commands/dev.ts'),
      'utf-8',
    )
    const call = source.slice(source.indexOf('server = await createServer({'))
    const serverBlock = call.slice(call.indexOf('server: {'), call.indexOf('logLevel:'))

    expect(serverBlock).not.toMatch(/\bwatch\s*:/)
  })
})
