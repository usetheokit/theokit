/**
 * What a built package actually declares, read from its `.d.ts`.
 *
 * ## Why this exists, and why it follows `export *`
 *
 * The naive version — grep the entry file for a name — is wrong in a way that produces FALSE
 * ABSENCE, the worst direction for a guard: a barrel that says `export * from './tools-entry.js'`
 * mentions none of the 38 names it forwards, so a check built on grep reports them missing and the
 * reader concludes the package does not ship them. This resolves one hop through `export *` so the
 * answer matches what a consumer's `import` would find.
 *
 * ## Why it lives here now
 *
 * It was written inline in `tests/integration/crossval-gaps.test.ts`, deliberately, because it had
 * exactly ONE consumer and `rules/system-design-guardrails.md § G12` says extract on the repetition,
 * not in anticipation of it — an earlier attempt to extract it early was undone at a phase-boundary
 * review for exactly that reason. `check-invention-reachability.mjs` is the second consumer, and it
 * asks the identical question ("does this package declare this name?"), so this is the repetition.
 *
 * `check-surface-parity.mjs` also parses `.d.ts`, and is deliberately NOT merged in here: it answers
 * a SUBPATH-scoped question, so it looks similar and means something else. Merging them would be the
 * accidental coupling the same rule warns about.
 *
 * Declared limitation: callers that union every `.d.ts` in a `dist/` get internal bundler chunks
 * too, so some mangled aliases enter the set, and WHICH subpath a name comes from is not answered —
 * only that the package declares it somewhere.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const DECLARATION_RE =
  /^[ \t]*(?:export )?(?:declare )?(?:abstract )?(?:const|function|class|type|interface|enum) ([A-Za-z_$][\w$]*)/gm
const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}/g
const STAR_FORWARD_RE = /^export\s+\*\s+from\s+'([^']+)'/gm

/**
 * The declaration files a resolved JS path might have.
 *
 * `require.resolve` picks the CJS branch, whose declarations are `.d.cts` when a package ships dual
 * types — going straight to `.d.ts` happens to work for the SDK only because it ships both.
 *
 * @param {string} resolvedJsPath
 * @returns {string[]}
 */
export function typeCandidates(resolvedJsPath) {
  return [
    resolvedJsPath.replace(/\.cjs$/, '.d.cts'),
    resolvedJsPath.replace(/\.[cm]?js$/, '.d.ts'),
    resolvedJsPath.replace(/\.mjs$/, '.d.mts'),
  ]
}

/**
 * Every name declared or re-exported by `text`, following `export *` ONE hop when `resolveFrom` is
 * given. One hop, not transitively: a forward chain deeper than that is a design smell worth
 * seeing rather than papering over, and unbounded following turns a guard into a crawler.
 *
 * @param {string} text
 * @param {string} [resolveFrom] a path to resolve `export *` specifiers against (usually a package.json)
 * @returns {{ names: Set<string>, unresolvedForwards: string[] }}
 */
export function declaredExportsFromText(text, resolveFrom) {
  const names = new Set()
  /** @type {string[]} */
  const unresolvedForwards = []

  /**
   * @param {string} source
   * @param {boolean} follow
   */
  const harvest = (source, follow) => {
    for (const m of source.matchAll(DECLARATION_RE)) names.add(m[1])
    for (const block of source.matchAll(EXPORT_BLOCK_RE)) {
      for (const spec of block[1].split(',')) {
        // `A as B` exports B; a bare `A` exports A. The LAST identifier is the exported name.
        const ids = spec.trim().match(/[A-Za-z_$][\w$]*/g)
        if (ids?.length) names.add(ids[ids.length - 1])
      }
    }
    if (!follow || !resolveFrom) return
    const require_ = createRequire(resolveFrom)
    for (const star of source.matchAll(STAR_FORWARD_RE)) {
      const spec = star[1]
      try {
        const dts = typeCandidates(require_.resolve(spec)).find((c) => existsSync(c))
        if (!dts) {
          // Reported rather than swallowed: an unresolved forward means the answer is INCOMPLETE,
          // and a guard that quietly returns a short list is a guard that passes for the wrong
          // reason.
          unresolvedForwards.push(spec)
          continue
        }
        harvest(readFileSync(dts, 'utf8'), false)
      } catch {
        unresolvedForwards.push(spec)
      }
    }
  }

  harvest(text, Boolean(resolveFrom))
  return { names, unresolvedForwards }
}
