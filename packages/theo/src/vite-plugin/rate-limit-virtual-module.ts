/**
 * A virtual module that binds a deployed entry to the REAL rate limiter.
 *
 * B-262 — 973 of 6077 lines under `adapters/` are lines whose entire content is an emitted string,
 * and `tsc` cannot see one of them. B-257 paid the bill: `createDurableRateLimiterWeb` was used at
 * module scope and never imported, so the generated entry threw when it LOADED and the compiler
 * reported nothing. The only instrument that caught it was a test that loads and drives the entry.
 *
 * An entry that IMPORTS gets that class refused by the compiler, before any test runs.
 *
 * ## Why the id carries the target
 *
 * This module resolves inside the Vite build. The specifier it EMITS has to resolve wherever the
 * entry finally runs, and those are two different resolvers — `adapters/deno-deploy.ts:57` is the
 * only caller passing `importPrefix: 'npm:'`, because Deno resolves `npm:theokit/...` and nothing
 * else. One id with one specifier would work on five targets and fail the sixth at LOAD, which is
 * the defect this file exists to remove, reintroduced by its own fix.
 *
 * So the target is part of the id, and `load` reads it. An id with no target is REFUSED rather than
 * defaulted: guessing the bare specifier breaks Deno, guessing the prefix breaks the other five,
 * and there is no third answer that is right for both.
 */

/** The id an adapter writes into the entry it emits. */
export const RATE_LIMIT_VIRTUAL_ID = '@theo/rate-limit'

/**
 * Rollup marks a resolved virtual id with a leading NUL so no file resolver touches it. The
 * convention is the bundler's, and `actions-virtual-module.ts:27` already follows it here.
 */
const RESOLVED_PREFIX = `\0${RATE_LIMIT_VIRTUAL_ID}`

/** The one target whose runtime does not resolve a bare npm specifier. */
const NPM_PREFIXED_TARGETS = new Set(['deno-deploy'])

/**
 * The plugin's shape, narrowed to what this module implements.
 *
 * Declared rather than imported from `vite`: these two hooks are the whole surface, and a structural
 * type keeps the unit test free of a bundler it never runs.
 */
export interface RateLimitVirtualModule {
  readonly name: string
  resolveId: (id: string) => string | undefined
  load: (id: string) => string | undefined
}

/** The target named in the id, or `undefined` when the id carries none. */
function targetOf(id: string): string | undefined {
  const query = id.slice(RESOLVED_PREFIX.length)
  if (!query.startsWith('?')) return undefined
  return new URLSearchParams(query.slice(1)).get('target') ?? undefined
}

export function rateLimitVirtualModule(): RateLimitVirtualModule {
  return {
    name: 'theo:rate-limit-virtual-module',

    resolveId(id: string): string | undefined {
      return id.startsWith(RATE_LIMIT_VIRTUAL_ID) ? `\0${id}` : undefined
    },

    load(id: string): string | undefined {
      if (!id.startsWith(RESOLVED_PREFIX)) return undefined

      const target = targetOf(id)
      if (target === undefined) {
        throw new Error(
          `[theokit] the rate-limit virtual module was asked to load \`${id}\` with no \`target\` in ` +
            `the id. The target decides the specifier — Deno needs \`npm:theokit/server/rate-limit\` ` +
            `and the other five need the bare one — so there is no safe default to guess.`,
        )
      }

      const specifier = NPM_PREFIXED_TARGETS.has(target)
        ? 'npm:theokit/server/rate-limit'
        : 'theokit/server/rate-limit'

      // A re-export, not a copy. What the entry binds to is the same function the sync facade sits
      // beside, so a change to the limiter reaches every deployed target without this file moving.
      return `export { createDurableRateLimiterWeb } from '${specifier}'\n`
    },
  }
}
