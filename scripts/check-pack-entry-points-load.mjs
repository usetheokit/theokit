#!/usr/bin/env node
/**
 * Release guard — every declared entry point must LOAD from the tarball, not merely exist in it.
 *
 * ## The gap this closes, and who found it
 *
 * `check-pack-exports-resolve.mjs` asserts that each `exports` target is INSIDE the archive. Its own
 * docblock admits the limit — "whether a present module also LOADS is a different question" — as a
 * justification for being cheap. TheoCode, reviewing that file through a frontier model on
 * 2026-09-15, returned it as the gap it is, with the consumer path spelled out: the resolver finds
 * `package/dist/index.js`, the error surfaces only when `import` actually runs, and a script that
 * checks presence never reaches that point. That became B-089, and this is B-089.
 *
 * It packs each publishable package, installs the tarball into an empty directory, and imports every
 * non-wildcard subpath its map declares. That catches what presence cannot: an undeclared runtime
 * dependency, a module that throws on evaluation, a `files` list that shipped the file and not what
 * the file imports.
 *
 * ## Two refusals that are not conveniences
 *
 * A package declaring only `bin` promises a COMMAND, not a module. Probing it for an importable "."
 * invents an entry point it never offered — `create-theokit` failed exactly that way on the first
 * run, and reporting it would have been a defect in this script wearing the product's name.
 *
 * Peers are installed before importing. `@theokit/agents/client/react` declares `react: >=18` as a
 * peer; without it the import fails for something the CONSUMER owes. Probing without peers accuses a
 * package of breaking the very contract it honours.
 *
 * Both were measured on the first run: 2 of 61 "failed", and neither was a defect.
 *
 * ## Why it is not in `check:all`
 *
 * It installs seven tarballs. The cheap sibling runs in 2s and stays where it is — it catches a
 * different defect, and replacing it would trade coverage for coverage. This runs in `release.yml`,
 * where packing is already serial and where a verdict can still stop a publish.
 *
 * Usage: `node scripts/check-pack-entry-points-load.mjs [package-name]`
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const only = process.argv[2]
const pkgs = readdirSync('packages', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join('packages', e.name))
  .filter((dir) => {
    try {
      const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      // A package that declares only `bin` promises a COMMAND, not a module. Probing it for an
      // importable "." invents an entry point it never offered — `create-theokit` failed exactly
      // that way, and the finding would have been about this script.
      const importable = j.exports !== undefined || j.main !== undefined || j.module !== undefined
      return j.private !== true && importable && (!only || j.name === only)
    } catch {
      return false
    }
  })

let bad = 0,
  checked = 0
for (const dir of pkgs) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const out = mkdtempSync(join(tmpdir(), 'load-'))
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    execFileSync('pnpm', ['pack', '--pack-destination', out], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const tgz = readdirSync(out).find((f) => f.endsWith('.tgz'))
    writeFileSync(
      join(out, 'package.json'),
      JSON.stringify({ name: 'probe', private: true, type: 'module', version: '1.0.0' }),
    )
    // PEERS TOO. `@theokit/agents/client/react` declares `react: >=18` as a peer, and without it
    // the import fails for something the CONSUMER owes, not the package. Probing without peers
    // reports the package broken for honouring the contract it declared.
    const peers = Object.entries(manifest.peerDependencies ?? {})
      .filter(([n]) => !n.startsWith('@theokit/'))
      .map(([n, r]) => `${n}@${String(r).replace(/^>=/, '')}`)
    // Args built first so the CALL fits one line. `eslint-disable-next-line` binds to the next
    // LINE, and prettier — which lint-staged runs before eslint, for exactly this reason — breaks a
    // long call across lines, leaving the directive on `execFileSync(` and the rule firing on
    // `'npm',` below it. Measured here: an orphaned directive at 83 and an unguarded call at 85.
    const args = [
      'install',
      join(out, tgz),
      ...peers,
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
    ]
    const opts = { cwd: out, stdio: ['ignore', 'ignore', 'pipe'], timeout: 300000 }
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    execFileSync('npm', args, opts)

    const entries = Object.keys(manifest.exports ?? { '.': 1 }).filter(
      (k) => k.startsWith('.') && !k.endsWith('.json') && !k.includes('*'),
    )
    for (const e of entries) {
      const spec = e === '.' ? manifest.name : `${manifest.name}/${e.slice(2)}`
      checked += 1
      try {
        execFileSync(
          process.execPath,
          ['--input-type=module', '-e', `import(${JSON.stringify(spec)})`],
          { cwd: out, stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 },
        )
      } catch (err) {
        bad += 1
        const msg =
          String(err.stderr ?? err.message)
            .split('\n')
            .find((l) => /Error|Cannot|ERR_/.test(l)) ?? ''
        console.error(`  ✗ ${spec}\n      ${msg.trim().slice(0, 130)}`)
      }
    }
    console.log(`  ${manifest.name}: ${entries.length} entry point(s) probed`)
  } catch (err) {
    console.error(`  ! ${manifest.name}: ${String(err.message).slice(0, 110)}`)
    bad += 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}
console.log(
  bad
    ? `\nFAIL — ${bad} of ${checked} did not load.`
    : `\nPASS — all ${checked} declared entry points load from their tarball.`,
)
process.exit(bad ? 1 : 0)
