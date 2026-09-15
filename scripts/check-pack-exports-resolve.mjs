#!/usr/bin/env node
/**
 * Release guard — every path the export map declares must EXIST inside the tarball.
 *
 * ## The failure this exists to prevent
 *
 * `exports` is a promise: each subpath names a file a consumer may import. `files` decides what the
 * tarball actually carries. Nothing makes the two agree. A subpath whose build output is excluded —
 * a new directory not covered by `files`, a rename that missed one line — publishes a map pointing
 * at a file that is not in the archive, and every check inside this repository still passes: the
 * file exists on the machine that built it.
 *
 * It fails on the consumer's disk, at import, which is the one machine this repository never uses.
 *
 * Measured 2026-09-15: `theokit@0.66.0` declares 28 importable entry points, and nothing in this
 * repository exercised any of them. They were correct — verified by installing the published
 * package standalone and importing each one — but that was luck confirmed after the fact rather
 * than a guarantee kept. The sibling repository had the same shape and was not as lucky: 17 symbols
 * marked `@public` resolved from no entry point across four published releases (theokit-sdk#684).
 *
 * ## Why resolution rather than import
 *
 * Importing needs the dependency tree, which means a real install per package and a network. This
 * check runs offline on a tarball it just created, and catches the class that costs a release: a
 * DECLARED path the archive does not contain. Whether a present module also LOADS is a different
 * question, answered by a consumer that installs it — `TheoCode` does that for the packages it
 * depends on.
 *
 * ## The self-test is not optional
 *
 * `--self-test` proves the checker can FAIL before its verdict on real packages means anything. A
 * gate that only ever passed is indistinguishable from one that measures nothing, which is not a
 * hypothetical: the sibling repository's surface gate reported PASS over 408 symbols three times
 * while measuring none of them. It runs first, every time, and the check aborts if it does not fail.
 *
 * ## Where it runs, and why not in `check:all`
 *
 * It packs, and `check:all` runs through `run-p` beside a suite that packs too —
 * `@theokit/agents`' `test_the_list_reaches_the_packed_tarball` builds its own tarball. Measured
 * 2026-09-15: with both packing at once that test went from passing alone to timing out at its 30s
 * budget, having taken 42s. The repair is not to widen somebody else's timeout so a new gate fits;
 * it is to put the gate where packing is already serial. It runs in `release.yml` after the build,
 * which is also the only moment its verdict can still change anything.
 *
 * Usage: `node scripts/check-pack-exports-resolve.mjs` (all publishable packages)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Every string target in an export map, however deeply the condition object nests. */
function targetsOf(node, found = []) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) found.push(node)
    return found
  }
  if (node && typeof node === 'object') for (const v of Object.values(node)) targetsOf(v, found)
  return found
}

/** Declared targets that the archive does not carry. Pure, so the self-test can drive it. */
function missingTargets(exportsField, filesInTarball) {
  const present = new Set(filesInTarball)
  const missing = []
  for (const [subpath, node] of Object.entries(exportsField ?? {})) {
    for (const target of targetsOf(node)) {
      // A wildcard maps many files; asserting one path would be asserting a file nobody named.
      if (target.includes('*')) continue
      const inArchive = `package/${target.slice(2)}`
      if (!present.has(inArchive)) missing.push(`${subpath} -> ${target}`)
    }
  }
  return missing
}

function selfTest() {
  const missing = missingTargets(
    { '.': { import: './dist/index.js' }, './gone': { import: './dist/gone.js' } },
    ['package/package.json', 'package/dist/index.js'],
  )
  if (missing.length !== 1 || !missing[0].includes('./gone')) {
    console.error('[pack-exports] SELF-TEST FAILED — the checker cannot detect a missing target.')
    console.error(`  expected exactly one finding for ./gone, got ${JSON.stringify(missing)}`)
    process.exit(2)
  }
}

function publishablePackages() {
  return readdirSync('packages', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join('packages', e.name))
    .filter((dir) => {
      try {
        return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).private !== true
      } catch {
        return false
      }
    })
}

/** Pack `dir` and return its manifest plus the list of files the tarball carries. */
function packed(dir) {
  const out = mkdtempSync(join(tmpdir(), 'theokit-exports-'))
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    execFileSync('pnpm', ['pack', '--pack-destination', out], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const tarball = readdirSync(out).find((f) => f.endsWith('.tgz'))
    if (tarball === undefined) throw new Error(`pnpm pack produced no tarball in ${dir}`)
    const tgz = join(out, tarball)
    // The call sits DIRECTLY under the directive: `eslint-disable-next-line` covers one line, and
    // wrapping it in `JSON.parse(...)` pushed the call out of reach — the directive then reports as
    // unused while the call it was written for goes unguarded.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const manifestJson = execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    })
    const manifest = JSON.parse(manifestJson)
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const list = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n')
      .filter(Boolean)
    return { manifest, list }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

selfTest()

let broken = 0
let checked = 0
for (const dir of publishablePackages()) {
  const { manifest, list } = packed(dir)
  const missing = missingTargets(manifest.exports, list)
  const declared = Object.keys(manifest.exports ?? {}).length
  checked += declared
  if (missing.length > 0) {
    broken += missing.length
    console.error(
      `[pack-exports] ✗ ${manifest.name}: ${missing.length} declared path(s) not in the tarball:`,
    )
    for (const m of missing) console.error(`      ${m}`)
  } else {
    console.log(`[pack-exports] ${manifest.name}: ${declared} subpath(s), every target present`)
  }
}

if (broken > 0) {
  console.error(
    `\n[pack-exports] FAIL — ${broken} declared path(s) would publish pointing at a file the archive does not carry.`,
  )
  process.exit(1)
}
console.log(
  `[pack-exports] PASS — ${checked} declared subpath(s) across every publishable package resolve inside the tarball.`,
)
