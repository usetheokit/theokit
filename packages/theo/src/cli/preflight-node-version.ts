/**
 * Node version + native-binding ABI preflight for `theokit dev` / `theokit build` / `theokit start`.
 *
 * Why this exists:
 *   In multi-Node-version setups (developer workflow: Node 22 for one
 *   project, Node 20 for another, nvm switching frequently), the
 *   `nohup env ...` invocation pattern strips the nvm PATH prefix and
 *   the dev server launches under whichever `node` binary is FIRST in
 *   PATH at spawn time — NOT the version the calling shell reported.
 *
 *   When `theokit dev` boots under the wrong Node, every native binding
 *   in `node_modules` (`better-sqlite3`, optionally `@lancedb/lancedb`,
 *   etc.) fails with NODE_MODULE_VERSION mismatch on first use. The
 *   error message references a low-level binary path; the dev wastes
 *   time investigating a process-management issue.
 *
 *   This preflight runs UPFRONT (before any module that touches native
 *   bindings loads) and emits an actionable error referencing nvm + the
 *   pinned `.nvmrc` floor.
 *
 * What it does:
 *   1. Reads `process.versions.node` + `process.versions.modules` (ABI).
 *   2. If Node major < 22, refuse to boot with a nvm install/use hint.
 *   3. If at least one native binding's compiled ABI != current ABI,
 *      refuse to boot with a `pnpm rebuild <pkg>` hint.
 *
 * What it does NOT do:
 *   * Auto-rebuild — that's the SDK's preflight (vitest setup, sentinel
 *     cached). Auto-rebuild in a dev CLI is risky (slow, can run during
 *     `pnpm dev` watch loops).
 *   * Probe every native dep — only checks the ones the framework KNOWS
 *     are required (currently `better-sqlite3` because of the cost
 *     ledger + cron persistence + memory index DB).
 *
 * @internal
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const NODE_MIN_MAJOR = 22
const NODE_MIN_FULL = '22.12.0'

interface BindingProbe {
  pkg: string
  /** path under <cwd>/node_modules — used only for the diagnostic message */
  hintPath?: string
  required: boolean
}

const BINDINGS_TO_CHECK: readonly BindingProbe[] = [
  // better-sqlite3 is the only HARD-required native dep at framework boot
  // (cost ledger + cron persistence + memory index). Other native deps
  // (@lancedb/lancedb) are opt-in peers — preflight skips them when absent.
  { pkg: 'better-sqlite3', required: true },
  { pkg: '@lancedb/lancedb', required: false },
]

function checkNodeFloor(): { ok: true } | { ok: false; reason: string } {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  if (major >= NODE_MIN_MAJOR) return { ok: true }
  return {
    ok: false,
    reason:
      `theokit requires Node >= ${NODE_MIN_FULL} (you are running v${process.versions.node}).\n\n` +
      'Quick fix:\n' +
      '  nvm use 22                    # switch to a Node 22.x already installed\n' +
      "  nvm install 22.12             # install + switch if you don't have it\n\n" +
      'Why this matters:\n' +
      '  theokit ships AsyncLocalStorage + native fetch + structured WHATWG\n' +
      '  Streams optimizations that depend on Node 22 internals. Older Node\n' +
      '  versions silently miscompile SSR streaming and break native\n' +
      '  bindings (NODE_MODULE_VERSION mismatch).\n\n' +
      'Production tip: pin your CI runner to `actions/setup-node` v4 with\n' +
      "  `node-version-file: .nvmrc` — that's what `create-theokit` writes.",
  }
}

function checkBindingAbi(cwd: string): { ok: true } | { ok: false; reason: string } {
  const offenders: string[] = []
  // Build createRequire from the cwd so we resolve the consumer's deps,
  // NOT theokit's own node_modules.
  const cwdRequire = createRequire(join(cwd, 'package.json'))
  for (const probe of BINDINGS_TO_CHECK) {
    try {
      cwdRequire.resolve(probe.pkg)
    } catch {
      // not installed — required vs optional gates the behaviour
      if (probe.required) {
        offenders.push(`${probe.pkg} (required dep is NOT installed — run \`pnpm install\`)`)
      }
      continue
    }
    // Try a dry require — better-sqlite3 dlopens at load-time, so the ABI
    // mismatch surfaces here as a sync throw.
    try {
      cwdRequire(probe.pkg)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/NODE_MODULE_VERSION|was compiled against|did not self-register/.test(msg)) {
        offenders.push(`${probe.pkg} (compiled against different Node ABI)`)
      } else if (probe.required) {
        // surface non-ABI errors verbatim for required deps
        offenders.push(`${probe.pkg} (require failed: ${msg.split('\n')[0]})`)
      }
    }
  }
  if (offenders.length === 0) return { ok: true }
  return {
    ok: false,
    reason:
      `Native binding ABI mismatch detected (Node v${process.versions.node}, ABI ${process.versions.modules}).\n\n` +
      'Offending packages:\n' +
      offenders.map((o) => `  - ${o}`).join('\n') +
      '\n\nQuick fix:\n' +
      '  pnpm rebuild                  # rebuild ALL native bindings for current Node\n' +
      '  pnpm rebuild better-sqlite3   # rebuild just one\n\n' +
      'Why this happened:\n' +
      '  Your `theokit dev` (or build/start) launched under a different\n' +
      '  Node version than the one used to install/build node_modules.\n' +
      '  Common cause: `nohup env ...` strips the nvm PATH prefix, so the\n' +
      '  dev server picked the system `node` instead of `nvm use 22`.\n\n' +
      'Permanent fix:\n' +
      '  Prefix your dev/start command with the absolute Node 22 path:\n' +
      '    PATH="$(nvm which 22 | xargs dirname):$PATH" theokit dev\n' +
      '  Or use direnv with `.envrc` containing `use node 22.12.0`.',
  }
}

/**
 * Read `.nvmrc` from cwd if present — used only to enrich error messages
 * with the project's pinned floor. Falls back to the framework default.
 *
 * @internal
 */
function readNvmrcFloor(cwd: string): string | undefined {
  const path = join(cwd, '.nvmrc')
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI reads consumer's own .nvmrc; consumer owns cwd
  if (!existsSync(path)) return undefined
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same
    return readFileSync(path, 'utf8').trim()
  } catch {
    return undefined
  }
}

/**
 * Coerce common truthy env-var values to boolean. Convention: any explicit
 * truthy string activates ("1", "true", "yes"); empty/undefined/"0"/"false" → off.
 *
 * @internal
 */
function envFlagIsTruthy(value: string | undefined): boolean {
  if (value === undefined || value === '') return false
  const v = value.toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'no'
}

/**
 * Run the Node + ABI preflight. Throws a descriptive Error on mismatch
 * BEFORE any module that imports better-sqlite3 loads. The error message
 * is the only user-facing artefact — caller can rely on `error.message`
 * being a full actionable diagnostic.
 *
 * Escape hatches (env-var; honor production-grade observability):
 *   - `THEOKIT_SKIP_NATIVE_PREFLIGHT=1` — skip the ABI/native-binding check
 *     entirely (still enforces Node-floor version). Test fixtures + cleanroom
 *     consumer envs that don't actually use better-sqlite3 (no audit-log, no
 *     LanceDB embedder, etc.) can opt out. Documented as a Phase 6 readiness
 *     fix in docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md
 *     § Test infrastructure prerequisites (Option B).
 *
 * @throws Error with multi-line actionable message when Node version or
 *   native binding ABI is wrong.
 * @internal
 */
export function preflightNodeAndBindings(cwd: string): void {
  const nodeCheck = checkNodeFloor()
  if (!nodeCheck.ok) {
    const pinned = readNvmrcFloor(cwd)
    const suffix = pinned !== undefined ? `\n\nYour project pins Node ${pinned} in .nvmrc.` : ''
    throw new Error(`[theokit preflight] ${nodeCheck.reason}${suffix}`)
  }
  // T5a.2 prerequisite: env-var escape hatch for native-binding ABI check.
  // Node-floor check above stays enforced unconditionally.
  if (envFlagIsTruthy(process.env.THEOKIT_SKIP_NATIVE_PREFLIGHT)) return
  const abiCheck = checkBindingAbi(cwd)
  if (!abiCheck.ok) {
    throw new Error(`[theokit preflight] ${abiCheck.reason}`)
  }
}
