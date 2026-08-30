/**
 * Durable memory lands at a path the app declares, not at whatever directory the process was
 * started in (usetheokit/theokit#557).
 *
 * ## What was actually measured
 *
 * The reporter said `.memory({ enabled: true })` writes no `MEMORY.md`. I closed it claiming version
 * skew; they reopened with both `npm ls` outputs resolving one SDK, and they were right. Measuring
 * properly turned up something worse than "it does not write" — it writes somewhere nobody named,
 * and WHERE depends on the SDK version inside the range this framework accepts:
 *
 * | SDK | how the memory root is derived | where it lands |
 * |---|---|---|
 * | 4.52.1 (the declared floor) | `memoryRoot = resolve(memoryDir(opts.cwd))` | `process.cwd()` |
 * | >= 4.61 | `memoryHome = explicitSessionDir(local)` | `local.baseDir` |
 *
 * `packages/theo` declares `@theokit/sdk: ^4.52.1`, so both are inside the supported range and a
 * `pnpm update` moves the memory without touching a line of app code.
 *
 * The framework's own contribution is this: `mount-agent` passes `baseDir` ALWAYS and `cwd` only
 * when the agent opted into file-based config. `resolveDiscoveryCwd`'s own docblock says
 * `process.cwd()` "is not guaranteed to be the app root" — so on the floor, memory lands wherever
 * the operator happened to `cd` before starting the server.
 *
 * ## What this fixes, and what it does not
 *
 * It makes the root DETERMINISTIC on the floor by naming the cwd the app already resolved. It does
 * NOT make >= 4.61 write to `.theokit/memory/` — there the root comes off `baseDir`, one field that
 * governs two destinations, and that is `usetheokit/theokit-sdk#463`. What the framework can stop
 * doing is contributing a second source of nondeterminism on top of it.
 */
import { describe, expect, it } from 'vitest'

import {
  resolveMemoryCwd,
  resolveSessionBaseDir,
} from '../../packages/theo/src/server/agent/mount-agent.js'

const ROOT = '/srv/app'

describe('the memory root does not depend on the process working directory (#557)', () => {
  it('names the resolved app root when the agent enabled memory', () => {
    // The whole fix. Without a cwd the SDK falls back to `process.cwd()`, so the same app started
    // from `/` and from `/srv/app` writes its memory to two different places.
    expect(resolveMemoryCwd({ memory: { enabled: true } }, ROOT)).toBe(ROOT)
  })

  it('stays undefined when the agent did not enable memory', () => {
    // Load-bearing: passing a cwd unconditionally would change SKILL and settings discovery for
    // every agent that never asked for memory. `undefined` is what the SDK reads as "discover
    // everything", and that behaviour is not this issue's to change.
    expect(resolveMemoryCwd({}, ROOT)).toBeUndefined()
    expect(resolveMemoryCwd({ memory: { enabled: false } }, ROOT)).toBeUndefined()
  })

  it('reads the legacy decorator shape as ON, exactly as the adapter does', () => {
    // `@Memory({ provider })` carries no `enabled` field, and `assembleM8CreateOptions` treats its
    // mere presence as opt-in. If this function disagreed, an agent using the decorator would get
    // memory enabled by the adapter and its root left to `process.cwd()` by this one — the same
    // defect, reachable through the older surface.
    expect(resolveMemoryCwd({ memory: { provider: 'sqlite' } }, ROOT)).toBe(ROOT)
  })

  it('stays undefined when the app root could not be resolved', () => {
    // Nothing better than `process.cwd()` is available, and inventing a path would be worse than
    // the fallback: a wrong absolute root writes memory into a directory that is not the app.
    expect(resolveMemoryCwd({ memory: { enabled: true } }, undefined)).toBeUndefined()
  })

  it('is a DIFFERENT directory from the session transcript root', () => {
    // The two must not collapse. `baseDir` is where transcripts go; if memory resolved to the same
    // place, this fix would reproduce the >= 4.61 defect it exists to avoid contributing to.
    const memory = resolveMemoryCwd({ memory: { enabled: true } }, ROOT)
    const sessions = resolveSessionBaseDir(ROOT)

    expect(memory).not.toBe(sessions)
    expect(sessions).toBe('/srv/app/.data/agent-sessions')
  })
})
