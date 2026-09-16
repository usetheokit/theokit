/**
 * Every repository path the README cites resolves — or is deliberately ignored.
 *
 * B-134 was a citation to `docs/adr/0002-cycle-artifacts-are-promoted-to-docs.md`, offered as the
 * record of a decision. The file did not exist, was not tracked, and was not gitignored — so a
 * reader who cloned and asked why the toolchain was absent was sent to a document they could not
 * open. It was fixed by hand, and nothing stopped the next one.
 *
 * That is the shape B-150 named: a guarantee written into a Definition of Done is not a gate. This
 * is the gate.
 *
 * A path that IS gitignored passes. `.claude/` is local by design, and citing it is a deliberate
 * choice about what the reader can see — different from a citation that resolves to nothing.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'

/**
 * Paths the README DESCRIBES rather than cites, with the reason each is here.
 *
 * The distinction is real and the gate cannot see it: a citation says "the record is there", while a
 * description says "a file of this name plays this role". Getting it wrong in the permissive
 * direction is what B-134 was; getting it wrong in the strict direction makes the gate unusable and
 * it gets removed. Each entry names why, because an unexplained exemption is how a guard rots.
 */
const DESCRIBED_NOT_CITED = new Map([
  [
    'AGENTS.md',
    'the instruction file an operator may put in THEIR project — described in the configuration ' +
      'table, not a record in this repository',
  ],
  [
    'THEO.md',
    'same reason as AGENTS.md: a name the loader reads from the OPERATOR\'s repository. Added when ' +
      'the chain became THEO.md > AGENTS.md > CLAUDE.md — documenting a name we read is not the ' +
      'same as citing a file we have.',
  ],
  [
    'CLAUDE.md',
    'same reason again, and the one that matters most: this file exists precisely so a repository ' +
      'we did NOT write steers the agent. Requiring it here would mean the README could not ' +
      'describe the interop it just gained.',
  ],
  [
    'settings.json',
    "the configuration file an operator writes in THEIR project or home — the same category as " +
      'AGENTS.md. This repository has none to cite, and the README has to be able to name the file ' +
      'by itself when explaining that it replaced config.toml.',
  ],
  [
    'auth.json',
    'the credential store this product writes under the operator\'s home. Same category as ' +
      'settings.json: naming the file is how the environment table explains what THEOCODE_HOME ' +
      'moves, and a copy in this repository would be a committed credential store.',
  ],
  [
    'config.toml',
    'the file settings.json replaced. The README names it to say it is no longer read and how to ' +
      'convert it; requiring a copy in this repository would mean documenting the migration only ' +
      'by keeping the very file the migration removes.',
  ],
])

/** Backticked paths that look like repository files, not URLs, globs or shell fragments. */
// Foreign extensions (`rs`, `go`, `py`, `rb`, `java`, `sh`) are here deliberately. The list used to
// hold only what THIS repository writes, so a citation INTO a peer project — the exact thing a
// parity or provenance note contains — was invisible to the guard. Measured 2026-09-03: a Rust path
// into the gitignored study clone passed clean.
const PATH_RE =
  /`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:md|ts|tsx|mjs|cjs|json|yaml|yml|toml|rs|go|py|rb|java|sh))`/g

export function citedPaths(markdown) {
  return [...new Set([...markdown.matchAll(PATH_RE)].map((m) => m[1]))]
}

export function isIgnored(path, runGit = (args) => execFileSync('git', args, { encoding: 'utf8' })) {
  try {
    runGit(['check-ignore', '-q', path])
    return true
  } catch {
    return false
  }
}

/**
 * A cited path is dangling when a person who CLONES this repository cannot open it.
 *
 * That is two conditions, and the second was originally written backwards. Absent from disk is the
 * obvious one. Present but GITIGNORED is the other, and it is worse rather than exempt: the file is
 * guaranteed missing for every reader who is not sitting at this checkout, permanently. `ignored`
 * was an escape here until 2026-09-03, which admitted precisely the defect the guard was built for
 * — B-134 was a citation to `rules/public-copy.md`, and writing it as `.claude/rules/public-copy.md`
 * would have passed.
 *
 * `exists` and `ignored` are injected so the rule can be tested without a filesystem — the guard
 * that has no test is the one that reports clean over anything.
 */
export function danglingReferences(paths, { exists = existsSync, ignored = isIgnored } = {}) {
  return paths.filter((p) => !DESCRIBED_NOT_CITED.has(p) && (!exists(p) || ignored(p)))
}

/**
 * Backticked subpaths into THIS workspace's own packages — `@theocode/shared/shutdown`.
 *
 * A second shape for the same defect. `PATH_RE` requires a file extension, so it sees a citation to
 * a file and is blind to a citation to a package ENTRY POINT, which is how the README went on
 * advertising `@theocode/shared/shutdown` after the module was deleted in favour of the framework's.
 * A contributor following that row gets an unresolved specifier, which is exactly what this guard
 * exists to prevent — the extension is not new scope, it is the scope the guard already claimed.
 *
 * Scoped to `@theocode/` deliberately. `@theokit/agents/persistence` is a real, resolvable subpath
 * of an upstream dependency whose exports map is not ours to audit; treating it as ours would make
 * the guard report a dependency's surface as this repository's defect.
 */
const SUBPATH_RE = /`(@theocode\/[a-z0-9-]+)((?:\/[a-z0-9-]+)+)`/g

export function citedSubpaths(markdown) {
  const seen = new Map()
  for (const m of markdown.matchAll(SUBPATH_RE)) seen.set(`${m[1]}${m[2]}`, [m[1], `.${m[2]}`])
  return [...seen.values()]
}

/**
 * Reads a workspace package's exports map, or `undefined` when there is no such package.
 *
 * The two answers are different and the difference is the point: an unreadable manifest means the
 * name is not one of ours, not that its surface is broken.
 */
export function workspaceExports(pkg, read = readFileSync) {
  try {
    return JSON.parse(read(`packages/${pkg.split('/')[1]}/package.json`, 'utf8')).exports
  } catch {
    return undefined
  }
}

/**
 * A cited subpath is dangling when the package declares it in no exports map.
 *
 * A package with no manifest is passed over rather than reported. Absence of a manifest is absence
 * of evidence — asserting a missing export from it would be a claim nobody measured.
 */
export function danglingSubpaths(pairs, { exportsOf = workspaceExports } = {}) {
  return pairs
    .filter(([pkg, sub]) => {
      const map = exportsOf(pkg)
      return map !== undefined && !(sub in map)
    })
    .map(([pkg, sub]) => `${pkg}${sub.slice(1)}`)
}

/**
 * CHANGELOG.md is deliberately NOT checked, and the reason is worth writing down because the
 * omission looks like one.
 *
 * It was tried on 2026-09-03 — the CHANGELOG had been found citing a path into the gitignored study
 * clone, the same defect this guard exists for — and the extension produced 72 findings, 34 of them
 * still unresolvable after matching by filename suffix. Reading them is what settled it: the
 * CHANGELOG legitimately names `config.toml` and `auth.json` (files the USER has, not this repo),
 * `package-lock.json` (a file an entry describes DELETING), several under the gitignored `.claude/`,
 * and `docs/adr/0002-…` inside the very entry that records B-134 as a defect.
 *
 * A changelog is a historical narrative. "Must resolve in a fresh clone TODAY" is a category error
 * against a document whose job is to describe what was true then, and a gate that fires 34 times on
 * correct prose is a gate someone turns off — taking the README check with it.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const quiet = process.argv.includes('--quiet')
  const file = 'README.md'
  const markdown = readFileSync(file, 'utf8')
  const dangling = [
    ...danglingReferences(citedPaths(markdown)),
    ...danglingSubpaths(citedSubpaths(markdown)),
  ]
  if (dangling.length > 0) {
    process.stderr.write(
      `${file} cites ${String(dangling.length)} path(s) a reader who clones cannot open:\n` +
        dangling.map((p) => `  ${p}\n`).join('') +
        'A citation that resolves to nothing reads as a record that exists (B-134).\n',
    )
    process.exit(1)
  }
  if (!quiet) process.stdout.write(`${file}: every cited path resolves in a fresh clone\n`)
}
