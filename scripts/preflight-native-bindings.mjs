// Native-bindings ABI preflight (theokit). Runs as vitest globalSetup via
// tests/setup-native-bindings.ts. Detects a NODE_MODULE_VERSION (ABI) mismatch
// on native deps (better-sqlite3) and auto-rebuilds once in local dev; fails
// closed under CI. See CLAUDE.md > "Native bindings discipline".
//
// NOTE (EC-15, accepted risk): path heuristics assume POSIX separators. Dev
// targets are Linux/macOS (.nvmrc, pnpm store paths). Windows is out of scope.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Native deps whose compiled binary is ABI-locked to NODE_MODULE_VERSION. */
const NATIVE_DEPS = ['better-sqlite3']

const PNPM_MARKER = '/node_modules/.pnpm/'

/**
 * Decide the rebuild CWD for a failing native binding.
 *
 * EC-1 (workspace-link): when a binding loads through a symlinked sibling repo
 * (e.g. node_modules/@theokit/sdk -> ../theokit-sdk), the rebuild must run in
 * the SIBLING repo's root, not the consumer's. We resolve the symlink with
 * realpathSync and, if the real path escapes defaultCwd, anchor on the FIRST
 * `/node_modules/.pnpm/` segment to recover the sibling repo root.
 *
 * EC-14 (nested node_modules): a pnpm store path contains node_modules twice
 * (`<root>/node_modules/.pnpm/<pkg>/node_modules/<pkg>/...`). Anchoring on the
 * `.pnpm` marker (not bare `node_modules`) yields the repo root, not the inner
 * dir, regardless of nesting.
 */
export function findRebuildCwd(failingBindingPath, defaultCwd) {
  if (!failingBindingPath || !existsSync(failingBindingPath)) return defaultCwd
  let real
  try {
    real = realpathSync(failingBindingPath)
  } catch {
    return defaultCwd
  }
  let defaultReal = defaultCwd
  try {
    defaultReal = realpathSync(defaultCwd)
  } catch {
    /* defaultCwd may not exist in tests — fall back to the literal */
  }
  if (real.startsWith(defaultReal)) return defaultCwd // local, non-symlinked
  const marker = real.indexOf(PNPM_MARKER)
  return marker >= 0 ? real.slice(0, marker) : defaultCwd
}

function isAbiError(err) {
  const msg = String((err && err.message) || err || '')
  return /NODE_MODULE_VERSION|did not self-register|was compiled against a different Node/i.test(
    msg,
  )
}

function depsKey(abi, nativeDeps, depsVersions) {
  // Not a security context — this is a cache-busting key over the dep set, so a
  // fast non-cryptographic digest is fine. sha256 (not sha1) keeps the linter happy.
  const sig = nativeDeps.map((d) => `${d}@${depsVersions[d] ?? '?'}`).join(',')
  const hash = createHash('sha256').update(sig).digest('hex').slice(0, 12)
  return `${abi}-${hash}`
}

/** Run `pnpm rebuild <dep>` once, mapping a missing-pnpm spawn error (EC-8) to an actionable message. */
function rebuildOnce(dep, deps) {
  const cwd = findRebuildCwd(deps.resolveBinding(dep), deps.repoRoot)
  try {
    deps.execFile('pnpm', ['rebuild', dep], { cwd, stdio: 'inherit' })
  } catch (spawnErr) {
    if (spawnErr && spawnErr.code === 'ENOENT') {
      throw new Error(
        `Could not run 'pnpm rebuild ${dep}' — pnpm not found. ` +
          `Run your package manager's rebuild for ${dep} (e.g. 'npm rebuild ${dep}').`,
      )
    }
    throw spawnErr
  }
}

/** Re-probe a dep after a rebuild; an unresolved ABI mismatch becomes an actionable error (EC-7, no recursion). */
function reprobeOrThrow(dep, deps) {
  try {
    deps.requireDep(dep)
    deps.exerciseDep(dep)
  } catch (afterRebuild) {
    if (isAbiError(afterRebuild)) {
      throw new Error(
        `Native binding '${dep}' still has an ABI mismatch after rebuild ` +
          `(Node ABI ${deps.abi}). Your Node version may not match the build toolchain. ` +
          `Run: pnpm rebuild ${dep}`,
      )
    }
    throw afterRebuild
  }
}

/** Probe one native dep; on an ABI mismatch, fail closed in CI (EC-7) or rebuild once + re-probe in local dev. */
function preflightOneDep(dep, deps) {
  try {
    deps.requireDep(dep)
    deps.exerciseDep(dep)
    return
  } catch (err) {
    if (!isAbiError(err)) throw err // non-ABI failures are not ours to rebuild
    if (deps.env.CI) {
      throw new Error(
        `Native ABI mismatch for '${dep}' (NODE_MODULE_VERSION, Node ABI ${deps.abi}). ` +
          `CI mode: not auto-rebuilding. Run: pnpm rebuild ${dep}`,
      )
    }
    rebuildOnce(dep, deps)
    reprobeOrThrow(dep, deps)
  }
}

/**
 * Dependency-injected preflight core (test seam). The public
 * `ensureNativeBindings()` calls this with real fs/child_process/require.
 *
 * @param {object} deps
 */
export async function _preflight(deps) {
  const { abi, sentinelDir, nativeDeps, depsVersions, existsSync: exists } = deps

  const sentinel = join(
    sentinelDir,
    `preflight-native-${depsKey(abi, nativeDeps, depsVersions)}.ok`,
  )
  if (exists(sentinel)) return // EC-6: key includes deps-hash, so a changed dep set misses the sentinel

  for (const dep of nativeDeps) {
    preflightOneDep(dep, deps)
  }

  deps.mkdirSync(sentinelDir, { recursive: true })
  deps.writeFileSync(sentinel, 'ok')
}

function repoRootFromHere() {
  // scripts/preflight-native-bindings.mjs -> repo root is one dir up from scripts/
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

function readDepsVersions(repoRoot, nativeDeps) {
  const versions = {}
  const req = createRequire(import.meta.url)
  for (const dep of nativeDeps) {
    try {
      const pkgPath = req.resolve(`${dep}/package.json`, { paths: [repoRoot] })
      versions[dep] = JSON.parse(readFileSync(pkgPath, 'utf8')).version
    } catch {
      versions[dep] = '?'
    }
  }
  return versions
}

function exerciseRealDep(name) {
  const req = createRequire(import.meta.url)
  if (name === 'better-sqlite3') {
    const Database = req('better-sqlite3')
    new Database(':memory:').close() // forces dlopen of the native binding
  } else {
    req(name)
  }
}

function resolveRealBinding(name, repoRoot) {
  const req = createRequire(import.meta.url)
  try {
    // The module main resolves under the .pnpm store; good enough for findRebuildCwd.
    return req.resolve(name, { paths: [repoRoot] })
  } catch {
    return undefined
  }
}

/**
 * Public preflight. Wired as vitest globalSetup (tests/setup-native-bindings.ts).
 * Never throws on a healthy ABI; auto-rebuilds once in local dev; fails closed in CI.
 * @returns {Promise<void>}
 */
export async function ensureNativeBindings() {
  const abi = process.versions.modules
  const repoRoot = repoRootFromHere()
  const req = createRequire(import.meta.url)
  await _preflight({
    abi,
    sentinelDir: join(repoRoot, 'node_modules', '.cache'),
    repoRoot,
    nativeDeps: NATIVE_DEPS,
    depsVersions: readDepsVersions(repoRoot, NATIVE_DEPS),
    requireDep: (n) => req(n),
    exerciseDep: exerciseRealDep,
    resolveBinding: (n) => resolveRealBinding(n, repoRoot),
    execFile: (cmd, args, opts) => execFileSync(cmd, args, opts),
    existsSync,
    mkdirSync,
    writeFileSync,
    env: process.env,
  })
}
