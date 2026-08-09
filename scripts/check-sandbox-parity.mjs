#!/usr/bin/env node
/**
 * M75 T4.2 — parity gate for the sandbox subsystem.
 *
 * ## The problem it solves
 *
 * `@theokit/agents/sandbox` is a pass-through (`export * from '@theokit/sdk/sandbox'`), so
 * everything the SDK exports crosses automatically. That is excellent until the day the SDK
 * **removes** or **renames** a symbol: the consumer breaks at runtime, and nothing along the way
 * warned.
 *
 * This gate demands a WRITTEN DECISION per public symbol of the subsystem. A new symbol with no
 * decision fails; a symbol that vanished from the SDK but is still declared here fails too.
 *
 * ## Why it is born with its own CI job
 *
 * The precedent is M73: `check-auth-parity.mjs` was written, was correct, and ran in **zero** jobs
 * — it lived only inside `check:all`, which no workflow invoked. The review classified it as a
 * BLOCKER. A gate that does not run is not a gate; it is documentation with code syntax.
 *
 * ## Anti-vacuity floor
 *
 * If the scan returns fewer symbols than the floor, the gate FAILS instead of reporting "all good".
 * "Zero symbols, zero divergences" is true by absence of reading, and is the most common way a gate
 * certifies nothing at all — it happened six times across this series of milestones.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Floor: fewer than this means the scan broke, not that the SDK shrank. */
const SYMBOL_FLOOR = 20

/**
 * The written decision per symbol. Every entry needs a reason — the column exists so the next person
 * knows whether a symbol is public contract or a leaked detail.
 */
const DECISIONS = {
  // --- backend contract (pre-M75, from the original SDK) ---
  SandboxBackend: 'contract — the abstract class every backend implements',
  LocalSandbox: 'contract — local execution with no confinement',
  resolveSandbox: 'contract — resolves a SandboxProvider into a backend',
  SandboxSecurityError: 'contract — typed error for a policy violation',
  SandboxNotAvailableError: 'contract — typed error for an unavailable backend',
  provisionRepo: 'utility — clones a repo inside the sandbox',
  RepoProvisionError: 'typed error from provisionRepo',
  ProvisionRepoOptions: 'type — options for provisionRepo',
  ExecuteResult: 'type — the return of execute(); the contract between backend and caller',
  SandboxConfig: 'type — workDir/timeout/maxOutput/env that every backend accepts',
  SandboxProvider: 'type — backend OR factory; what allows resolving by context',

  // --- kernel confinement, promoted in M75 ---
  LinuxSandbox: 'M75 — o backend com enforcement de kernel (bwrap + seccomp)',
  createSandboxBackend:
    'M75 — the honest factory: confines when it can, degrades with a warning when it cannot, NEVER pretends',
  wrapCommandForSandbox: 'M75 — public API per the DoD: what composes the wrap outside the backend',
  interactiveWrapCommand:
    'M75 — the composition for the PTY; without it every consumer rewrites detect→warn→wrap',
  resolveSandboxPosture: "M75 — public API per the DoD: the UI answers 'am I confined right now?'",
  allowlistedEnv: 'M75 — the env re-injected after --clearenv (Codex env_clear model)',
  buildBwrapArgv: 'M75 — pure argv construction; testable without a host',
  buildSeccompFilter: 'M75 — the cBPF program as a Buffer, pure JS',
  detectBwrap: 'M75 — detection with injectable probes',
  detectBwrapMemoized: 'M75 — memoized detection, with revalidation of a stale positive (M71)',
  realProbes: 'M75 — the real probes; exported so tests can decide whether to run',
  realProbeCount: 'M75 — probe counter; the oracle for performance gates',
  resetBwrapMemo: 'M75 — memo reset, for isolation between tests',
  resetSandboxWarnLatch: 'M75 — reset of the warning latch on the non-interactive path',
  resetInteractiveWarnLatch: 'M75 — reset of the warning latch on the interactive path',
  seccompPathForArch:
    'M75 — ARCH GUARD: refuses to install seccomp outside x86_64 and warns. Came from a HIGH review finding; its disappearance from here is a security regression',
  restrictedSeccompPath: 'M75 — the path of the program written once per process',

  // --- types of the promoted subsystem (M75). Each is public because a caller needs to NAME it:
  //     without the exported type, whoever injects a probe or reads the posture only gets `any`.
  SandboxMode:
    "M75 — Codex's three canonical modes. SANDBOX vocabulary, not the consumer's config: 'danger-full-access' means 'do not wrap'",
  BwrapArgvOptions: 'M75 — type — the options of buildBwrapArgv (cwd/network/env/gitDirExists)',
  BwrapDetection:
    'M75 — type — the discriminated detection result: { ok:true, bin } | { ok:false, reason }. The `reason` is what makes the downgrade HONEST rather than silent',
  BwrapProbes: 'M75 — type — the three injectable probes; what allows testing without a host',
  SeccompOptions:
    'M75 — type — { networkRestricted }: seccomp is only installed with a restricted network',
  CreateSandboxBackendOptions: 'M75 — type — the factory options, with injectable detect/warn',
  InteractiveWrapOptions: 'M75 — type — the options of the PTY composition',
  SandboxPosture:
    "M75 — type — { mode, enforced, detail }: what the UI shows. `detail` carries the REASON, without which 'not confined' leaves the user with no action",
}

/**
 * DELIBERATE ORDER: the AUTHORING SOURCE first, the installed package second.
 *
 * This repo's `node_modules/@theokit/sdk` is a workspace link that can point at a stale tree — on
 * this gate's first run it resolved to **4.19.2** while authoring was already at 4.21.1, and the
 * gate reported 18 "orphan decisions" that were nothing of the sort. Reading the link first would
 * make the gate measure the old copy and accuse the author of removing symbols they had just added.
 *
 * The order works in CI too: the job clones `theokit-sdk` as a sibling before installing.
 */
const readEntry = () => {
  for (const p of [
    '../theokit-sdk/packages/sdk/src/sandbox/index.ts',
    'node_modules/@theokit/sdk/dist/sandbox/index.d.ts',
  ]) {
    try {
      return { text: readFileSync(join(ROOT, p), 'utf8'), source: p }
    } catch {
      // try the next one — the repo may be installed or in a workspace
    }
  }
  console.error(
    'FAILURE: could not find the SDK sandbox entry. The gate must NOT report success without reading anything.',
  )
  process.exit(2)
}

const { text, source } = readEntry()

/** Names exported by the barrel — covers `export { a, b }` and `export type { T }`. */
const symbols = new Set()
for (const bloco of text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
  for (const bruto of bloco[1].split(',')) {
    // The PUBLIC name is the one AFTER the `as` — that is what the consumer imports. The first
    // version took `[0]` (the source name), so a symbol exported under an alias escaped the gate
    // entirely. Found by mutation: adding
    // `export { LinuxSandbox as NewSymbolWithNoDecision }` did NOT make the gate fail.
    //
    // Tokenize instead of `split(/\s+as\s+/)`: that pattern has two greedy quantifiers around a
    // literal and the linter marks it as super-linear (ReDoS). The shape is `[Name]` or
    // `[Source, "as", Public]`, so the last token is already the answer — with no backtracking.
    const tokens = bruto
      .replace(/\btype\b/, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const name = tokens.at(-1) ?? ''
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) symbols.add(name)
  }
}

const failures = []

if (symbols.size < SYMBOL_FLOOR) {
  failures.push(
    `ANTI-VACUITY FLOOR: the scan found ${symbols.size} symbols in ${source}, below the floor of ` +
      `${SYMBOL_FLOOR}. "No divergences" over an empty list is true by absence of reading, not by ` +
      `parity. Fix the scan before trusting the result.`,
  )
}

for (const name of symbols) {
  if (!(name in DECISIONS)) {
    failures.push(
      `NO DECISION: "${name}" is exported by ${source} and crosses @theokit/agents/sandbox, but has no ` +
        `entry in DECISIONS. Add a line saying WHY it is public.`,
    )
  }
}

for (const name of Object.keys(DECISIONS)) {
  if (!symbols.has(name)) {
    failures.push(
      `ORPHAN DECISION: "${name}" has a written decision but is NO LONGER exported by the SDK. Either ` +
        `the symbol was removed (and the layer broke silently), or the decision is stale.`,
    )
  }
}

if (failures.length > 0) {
  console.error(`\ncheck-sandbox-parity: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  - ${f}\n`)
  process.exit(1)
}

console.log(
  `check-sandbox-parity: OK — ${symbols.size} symbols, all with a written decision (source: ${source}).`,
)
