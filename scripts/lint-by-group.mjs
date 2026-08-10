#!/usr/bin/env node
/**
 * `npm run lint`, but one process per group — agent-builder#119.
 *
 * ## What was measured
 *
 * `eslint . --max-warnings=0` never finished: OOM with the default heap, OOM with 8 GB, and with
 * 12 GB it stopped blowing up but did not converge — killed at 15 min with ~10.5 GB RSS on a 15.6 GB
 * machine. The layer's lint went **without a verdict** for two review rounds, and three real errors
 * reached `develop` because only a scoped run (`npx eslint <paths>`) gave an answer.
 *
 * Measured per group, each one **finishes on its own**:
 *
 * | Group | Time | Peak RSS |
 * |---|---|---|
 * | `packages/presenter` | 12 s | 0,85 GB |
 * | `tests` | 58 s | 1,6 GB |
 * | `packages/agents` | 102 s | 1,6 GB |
 * | `packages/http` | 106 s | 2,6 GB |
 * | `packages/theo` | 206 s | 2,9 GB |
 *
 * The sum of the peaks ≈ **9.6 GB** — which is the observed RSS. The cause is neither a pathological
 * file nor a slow rule: it is `projectService: true` over a monorepo **in a single process**. The
 * service keeps every package's TypeScript program alive simultaneously, and nothing is released
 * until the end.
 *
 * One process per group makes the operating system release each program on exit. The ceiling becomes
 * the **largest** group (2.9 GB), not the **sum**.
 *
 * ## Why not `pnpm -r exec eslint`
 *
 * Because it only scans workspaces, and `tests/` (573 files — the second-largest group) and
 * `scripts/` live at the root. A lint covering less than the `eslint .` it replaces is not the same
 * gate; it is a smaller gate with the same name.
 *
 * ## The root is DERIVED, and there is an anti-vacuity floor
 *
 * The groups come from the **git index** crossed with ESLint's own `isPathIgnored` — never from a
 * hand-written list. A hand-written list would fail by **omission**: a new package would simply not
 * be scanned, and nobody would notice, which is how the gate dies in silence.
 *
 * And deriving is not enough: before running anything, this script checks that **every** file ESLint
 * lints falls into **some** group. If one is left over, it fails loud instead of scanning 99% and
 * reporting green — a scan that returns less than it should looks identical to a complete one.
 */

import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { ESLint } from 'eslint'

const EXTENSIONS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs']

/** Every tracked file ESLint would actually lint — the git index is the source. */
async function lintableFiles() {
  // `git` from PATH is this script's contract: it runs as `npm run lint`, in the repository, with the
  // same `git` the developer uses. An absolute path would break on macOS/nix and closes no threat —
  // whoever controls the PATH of a local lint already controls the `node` that runs it.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
  const out = spawnSync('git', ['ls-files', ...EXTENSIONS], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`)
  const eslint = new ESLint()
  const todos = out.stdout.trim().split('\n').filter(Boolean)
  const lintable = []
  for (const f of todos) if (!(await eslint.isPathIgnored(f))) lintable.push(f)
  return lintable
}

/**
 * A file's group: `packages/<name>` for a package, the first segment for the rest, and `.` for a root
 * file (`eslint.config.js`, `vitest.config.ts`, …).
 */
function groupOf(file) {
  const parts = file.split('/')
  if (parts.length === 1) return '.'
  if (parts[0] === 'packages' && parts.length > 2) return `packages/${parts[1]}`
  return parts[0]
}

function lintar(grupo, argsExtras) {
  // A root file becomes an explicit list: `eslint .` would be exactly the single process this script
  // exists to avoid running.
  const target = grupo === '.' ? rootGroups : [grupo]
  const start = Date.now()
  // Same rationale as `git` above: it is the project's `npx` that must run, and it comes from the
  // PATH `npm run` already assembled.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
  const r = spawnSync('npx', ['eslint', ...target, ...argsExtras], { stdio: 'inherit' })
  return { grupo, seconds: (Date.now() - start) / 1000, ok: r.status === 0 }
}

let rootGroups = []

async function main() {
  const argsExtras = process.argv.slice(2)
  if (!argsExtras.includes('--fix')) argsExtras.push('--max-warnings=0')

  const fileList = await lintableFiles()
  if (fileList.length === 0) {
    console.error('lint: no lintable file — the filter is wrong, not the repository')
    process.exit(2)
  }

  const byGroup = new Map()
  for (const f of fileList) {
    const g = groupOf(f)
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g).push(f)
  }
  rootGroups = byGroup.get('.') ?? []

  // Anti-vacuity floor: the coverage must close. It does not → fail loud.
  const covered = [...byGroup.values()].reduce((n, v) => n + v.length, 0)
  if (covered !== fileList.length) {
    console.error(`lint: coverage does not close — ${covered} of ${fileList.length}`)
    process.exit(2)
  }

  // Largest group first: if something is going to blow memory, let it blow at 3 min and not at 8.
  const groups = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length).map(([g]) => g)
  console.error(`lint: ${fileList.length} files in ${groups.length} groups, one process each`)

  const results = []
  for (const g of groups) results.push(lintar(g, argsExtras))

  console.error('\n— summary —')
  for (const r of results) {
    const n = byGroup.get(r.grupo).length
    console.error(
      `${r.ok ? 'ok  ' : 'FAIL'} ${r.seconds.toFixed(1).padStart(7)}s ${String(n).padStart(5)} files  ${r.group}`,
    )
  }
  const failures = results.filter((r) => !r.ok)
  console.error(
    failures.length === 0
      ? `lint: green across ${groups.length} groups`
      : `lint: ${failures.length} group(s) with findings`,
  )
  process.exit(failures.length === 0 ? 0 : 1)
}

await main()
