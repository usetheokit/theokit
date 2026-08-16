/**
 * What a package's published `.d.ts` surface actually offers a consumer.
 *
 * ## Why this exists as a module and not inline in the test that needed it
 *
 * Two other scripts already parse `.d.ts` export lists — `check-surface-parity.mjs` and
 * `check-sandbox-parity.mjs` — and neither follows `export *`. This is deliberately the place the
 * third copy did NOT get written: `tests/integration/crossval-gaps.test.ts` consumes it, and the
 * layer→consumer gate (plan `crossval-4-6-absorption` T4.1) consumes the same function rather than
 * re-deriving "what does this package export", which is the DRY violation
 * `rules/system-design-guardrails.md § G12` names. The two existing copies are noted for
 * consolidation but not touched here — that is a separate change with its own tests.
 *
 * ## The `export *` hop is the whole point
 *
 * A parser that reads only `declare` and `export {}` reports a false ABSENCE for every symbol a
 * package forwards. `@theokit/agents`'s `dist/index.d.ts` carries five such forwards, and they
 * contribute 38 names — including `TheokitAgentError`, which two independent measurements called
 * unreachable while `import()` proves otherwise. The false absence is the expensive direction: a
 * gate that reports it rejects a correct row, and the reflex on a red CI is to delete the row,
 * removing a real capability from the map.
 *
 * One hop is enough for every forward in this ecosystem and keeps the walk terminating without a
 * cycle check. A target that cannot be read is REPORTED, never silently treated as exporting
 * nothing — a quiet empty set is how a guard goes vacuous a second time.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Declaration forms. `declare` is OPTIONAL on purpose: bundled `.d.ts` output emits bare
 * `interface Foo {}` and `type Bar = …` (measured in `packages/agents/dist`: 215 bare interfaces,
 * 80 bare types, zero `export declare`). Requiring the keyword loses 49 real names, and this
 * function is used as a gate where a false negative costs a deleted export.
 */
const DECLARATION_RE =
  /^[ \t]*(?:export )?(?:declare )?(?:abstract )?(?:const|function|class|type|interface|enum) ([A-Za-z_$][\w$]*)/gm

const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}/g
const STAR_FORWARD_RE = /^export\s+\*\s+from\s+'([^']+)'/gm

/** Candidate type-declaration files for a resolved runtime path, in resolution order. */
function typeCandidates(resolvedJsPath) {
  // `require.resolve` picks the CJS branch, whose declarations are `.d.cts` when the package ships
  // dual types. Falling straight to `.d.ts` happens to work for the SDK today because it ships
  // both; relying on that would break silently on a package that ships only `.d.cts`.
  return [
    resolvedJsPath.replace(/\.cjs$/, '.d.cts'),
    resolvedJsPath.replace(/\.[cm]?js$/, '.d.ts'),
    resolvedJsPath.replace(/\.mjs$/, '.d.mts'),
  ]
}

/**
 * Harvest every exported name from `text`, following `export *` one hop when `resolveFrom` is given.
 *
 * @param {string} text - `.d.ts` source.
 * @param {string} [resolveFrom] - path whose module resolution is used for star targets. Omit to
 *   parse text alone (this is what makes the function testable without a real `node_modules`).
 * @returns {{ names: Set<string>, unresolvedForwards: string[] }}
 */
export function declaredExportsFromText(text, resolveFrom) {
  const names = new Set()
  const unresolvedForwards = []

  const harvest = (source, follow) => {
    for (const m of source.matchAll(DECLARATION_RE)) names.add(m[1])
    for (const block of source.matchAll(EXPORT_BLOCK_RE)) {
      for (const spec of block[1].split(',')) {
        // `A as B` exports B; a bare `A` exports A. The LAST identifier is the exported name.
        const ids = spec.trim().match(/[A-Za-z_$][\w$]*/g)
        if (ids?.length) names.add(ids[ids.length - 1])
      }
    }
    if (!follow) return
    const require_ = createRequire(resolveFrom)
    for (const star of source.matchAll(STAR_FORWARD_RE)) {
      const spec = star[1]
      try {
        const dts = typeCandidates(require_.resolve(spec)).find((p) => existsSync(p))
        if (!dts) {
          unresolvedForwards.push(spec)
          continue
        }
        harvest(readFileSync(dts, 'utf8'), false) // one hop only
      } catch {
        unresolvedForwards.push(spec)
      }
    }
  }

  harvest(text, Boolean(resolveFrom))
  return { names, unresolvedForwards }
}

/**
 * The published surface of a package whose `dist/` holds `.d.ts` files.
 *
 * Declared limitation: this unions EVERY `.d.ts` in the directory, internal bundler chunks
 * included, so a handful of mangled single-character aliases enter the set and the *subpath* a
 * symbol is exported from is not checked — only that the package exports it somewhere. Narrowing
 * to per-subpath resolution is a separate, larger change.
 *
 * @returns {{ names: Set<string>, unresolvedForwards: string[], built: boolean }}
 */
export function declaredExportsOfPackage(packageDir) {
  const dist = join(packageDir, 'dist')
  if (!existsSync(dist)) return { names: new Set(), unresolvedForwards: [], built: false }
  const text = readdirSync(dist)
    .filter((f) => f.endsWith('.d.ts'))
    .map((f) => readFileSync(join(dist, f), 'utf8'))
    .join('\n')
  if (text.length === 0) return { names: new Set(), unresolvedForwards: [], built: false }
  const out = declaredExportsFromText(text, join(packageDir, 'package.json'))
  return { ...out, built: true }
}

/** The root symbol of a citation: `AgentBuilder.create` → `AgentBuilder`, `Agent<T>` → `Agent`. */
export function rootSymbol(cited) {
  return cited.split('.')[0].split('<')[0]
}
