/**
 * The inverse of surface parity: when the layer INVENTS a capability, is that capability reachable?
 *
 * `check-surface-parity.mjs` asks whether the layer forwards what the SDK exports at a shared
 * subpath name, and its own contract says it can only ask that — it skips 14 own-surface subpaths
 * with the reason written down. Nothing asked the other direction, and two capabilities crossed the
 * boundary in half because of it:
 *
 *  - `ApprovalPosture` — the TYPE was exported; `applyPosture`, which IS the enforcement, was
 *    exported by nothing. A surface could describe the posture and could not apply it, so the
 *    consumer implemented the rule itself. Twice.
 *  - `TheokitAgentError` — base of 29 subclasses, unexported, so a `catch` could not discriminate.
 *
 * ## The rule is a PAIR, and that is what makes it usable
 *
 * An exported type whose name reads like a decision (`…Posture`, `…Policy`, `…Decision`, `…Mode`,
 * `…Strategy`) AND a function in the SAME module taking that type as a parameter. A name match alone
 * would flag every type in the package and become a gate nobody reads; the function is the evidence
 * that something in this module ACTS on the type, which is the thing a caller cannot do.
 *
 * It is still a heuristic and will produce false positives (Risk R7). That is why the gate runs in
 * warn mode, prints its allowlist path, and every allowlist entry carries a sunset — an exemption
 * that never expires is where findings go to be forgotten.
 */

/** Names that read as "a decision the caller has to be able to act on". */
const DECISION_NAME = /(?:Posture|Policy|Decision|Mode|Strategy)$/

/** `export type X =` / `export interface X` — a type that crossed the boundary. */
const EXPORTED_TYPE = /^[ \t]*export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm

/**
 * Functions declared in a module, with whether they are `export`ed and their parameter text.
 * Deliberately regex-based rather than AST: this gate is advisory, and a parser dependency for a
 * warn-mode heuristic is the kind of weight `rules/parsimony-ladder.md` rung 4 asks about.
 */
const FUNCTION_DECL =
  /^[ \t]*(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm

/**
 * @typedef {{ symbol: string, sunset: string, rationale: string }} AllowlistEntry
 * @typedef {{ path: string, text: string }} SourceModule
 * @typedef {{ type: string, module: string, enforcement: string[], allowlistExpired: boolean }} Finding
 */

/**
 * @param {{
 *   modules: SourceModule[],
 *   publishedNames: Set<string>,
 *   allowlist?: AllowlistEntry[],
 *   today?: string,
 * }} input
 * @returns {Finding[]}
 */
export function findUnreachableEnforcement(input) {
  const { modules, publishedNames } = input
  const allowlist = input.allowlist ?? []
  const today = input.today ?? new Date().toISOString().slice(0, 10)

  return modules.flatMap((module) => strandedTypesIn(module, publishedNames, allowlist, today))
}

/**
 * The findings for one module. Split out from the sweep so each reads as one idea: this decides
 * whether a type is stranded, the caller above just walks the tree.
 *
 * @param {SourceModule} module
 * @param {Set<string>} publishedNames
 * @param {AllowlistEntry[]} allowlist
 * @param {string} today
 * @returns {Finding[]}
 */
function strandedTypesIn(module, publishedNames, allowlist, today) {
  const functions = [...module.text.matchAll(FUNCTION_DECL)].map((m) => ({
    exported: Boolean(m[1]),
    name: m[2],
    params: m[3],
  }))

  /** @type {Finding[]} */
  const findings = []
  for (const match of module.text.matchAll(EXPORTED_TYPE)) {
    const type = match[1]
    if (!DECISION_NAME.test(type)) continue
    // Only capabilities that actually CROSSED. An internal type with an internal function is just
    // internal code, and flagging it would drown the real findings.
    if (!publishedNames.has(type)) continue

    // `: Type` or `: Type[]` or `: Pick<Type, …>` — the parameter mentions the type as a word.
    const mentions = new RegExp(`\\b${type}\\b`)
    const consumers = functions.filter((fn) => mentions.test(fn.params))
    if (consumers.length === 0) continue // a pure type module has no enforcement to strand

    // One reachable consumer is enough: the question is whether a caller can act on the type at
    // all, not whether every helper is exported.
    if (consumers.some((fn) => fn.exported && publishedNames.has(fn.name))) continue

    const entry = allowlist.find((a) => a.symbol === type)
    const expired = entry !== undefined && entry.sunset < today
    if (entry !== undefined && !expired) continue

    findings.push({
      type,
      module: module.path,
      // Every candidate, because which one to export is the human's call, not the gate's.
      enforcement: consumers.map((fn) => fn.name),
      allowlistExpired: expired,
    })
  }
  return findings
}
