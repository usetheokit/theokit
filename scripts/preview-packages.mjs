#!/usr/bin/env node
/**
 * Which packages a preview should publish (usetheokit/theokit#632).
 *
 * ## The defect this closes
 *
 * `preview.yml` publishes EVERY publishable package in one `pkg-pr-new` invocation, and pkg.pr.new
 * rewrites the internal dependencies of everything in one invocation to preview URLs. So the preview
 * of `@theokit/agents` declares `@theokit/presenter` as a URL rather than a registry range, that URL
 * is a SUBdependency from the consumer's side, and pnpm 11 ships `blockExoticSubdeps: true` by
 * default:
 *
 *     [ERR_PNPM_EXOTIC_SUBDEP] Exotic dependency "@theokit/presenter" (resolved via url) is not
 *     allowed in subdependencies when blockExoticSubdeps is enabled
 *
 * The preview exists so a sibling repository can verify a fix before a release; that is exactly the
 * consumer it refused. The workaround — `blockExoticSubdeps: false` — turns off a supply-chain guard
 * for the consumer's whole tree, which is a poor trade to leave as the documented path.
 *
 * ## Why "the packages this commit touched" and not "one invocation per package"
 *
 * Publishing each package in its own invocation would also remove the cross-URL, and it would remove
 * it in the one case where it is REQUIRED: a change that spans two packages needs the preview of the
 * first to carry the unpublished second. That case is the reason the cross-rewrite exists.
 *
 * Scoping to the touched packages keeps both properties:
 *
 *   - change inside one package  -> one package in the invocation -> siblings stay on registry
 *     ranges (measured: `pnpm pack` writes `"@theokit/presenter": "0.8.0"` from `workspace:*`), and
 *     the preview installs under a default pnpm 11;
 *   - change spanning two        -> both in the invocation -> the cross-URL between THEM survives,
 *     which is what that preview is for, and every untouched sibling still resolves from the
 *     registry.
 *
 * ## Fallbacks, and why they go wide rather than narrow
 *
 * With no diff to read — a manual dispatch, a shallow checkout, a commit touching no package — this
 * prints every publishable package, which is exactly what the workflow did before. Failing wide
 * keeps a preview being produced; failing narrow would silently stop previewing the package somebody
 * was about to verify, and a preview that is missing looks identical to a preview that is broken.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Every package with a name and `private !== true`, as `./packages/foo`. */
function publishablePackages() {
  const dirs = []
  for (const root of ['packages', 'apps']) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = join(root, entry.name, 'package.json')
      if (!existsSync(manifest)) continue
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (pkg.private === true || !pkg.name) continue
      dirs.push(`./${join(root, entry.name)}`)
    }
  }
  return dirs
}

/**
 * Files this commit changed, against the base it will be compared with.
 *
 * `null` — not an empty list — when the diff cannot be read. The two are different facts and only
 * one of them means "this commit touched no package"; treating an unreadable diff as an empty one
 * would publish nothing at all.
 */
function changedFiles() {
  const base = process.env.PREVIEW_DIFF_BASE ?? 'origin/develop'
  // Ordered by how well each answers "what did this branch change", with the later ones robust
  // where the earlier ones cannot run:
  //
  //   base...HEAD   what the branch added, ignoring what the base moved on. Needs a MERGE BASE, and
  //                 a shallow clone often has none — measured in CI, this is what failed there.
  //   base HEAD     two-dot: compares the two tips directly, no common ancestor required. Can name
  //                 a package the base moved and this branch did not, which publishes MORE than
  //                 needed. That is the safe direction.
  //   HEAD~1...HEAD the last commit alone, for a checkout with no base ref at all.
  const attempts = [[`${base}...HEAD`], [base, 'HEAD'], ['HEAD~1...HEAD']]
  for (const range of attempts) {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
      const out = execFileSync('git', ['diff', '--name-only', ...range], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return out.split('\n').filter(Boolean)
    } catch {
      // Next attempt. Every one failing means no diff is readable at all, which the caller treats
      // as "publish everything" rather than as "nothing changed".
    }
  }
  return null
}

/**
 * The decision, with no disk and no git in it.
 *
 * Separated from the two readers above so it can be tested as what it is: a pure function from
 * (every publishable package, the files a commit changed) to (the packages to publish). Leaving it
 * inline would have made the only possible test an integration one — a temporary git repository, a
 * subprocess per case — for a rule that is four lines of set logic. `rules/testing.md` § 2 puts
 * this in the base of the pyramid, and it belongs there.
 *
 * @param {readonly string[]} all every publishable package, as `./packages/foo`
 * @param {readonly string[] | null} changed changed paths, or `null` when the diff was unreadable
 * @returns {{ packages: readonly string[], reason: 'touched' | 'no-package-touched' | 'no-diff' }}
 */
export function selectPreviewPackages(all, changed) {
  // `dir` is `./packages/foo`; a changed path is `packages/foo/src/x.ts`.
  const touched =
    changed === null
      ? []
      : all.filter((dir) => changed.some((f) => f.startsWith(`${dir.slice(2)}/`)))

  if (touched.length > 0) return { packages: touched, reason: 'touched' }
  // Wide, in both fallbacks. See the module docblock: a preview that silently stops covering a
  // package is indistinguishable from a broken one.
  return { packages: all, reason: changed === null ? 'no-diff' : 'no-package-touched' }
}

const REASON_MESSAGE = {
  'no-diff':
    'preview: could not read a diff (shallow clone or manual dispatch) — previewing every package',
  'no-package-touched': 'preview: this commit touched no package — previewing every package',
}

/** Entry point. Kept to reading the world and printing; the rule lives above. */
function main() {
  const all = publishablePackages()
  if (all.length === 0) {
    console.error(
      'no publishable package found under packages/ or apps/ — the enumeration is wrong, not the repository',
    )
    process.exit(1)
  }

  const { packages, reason } = selectPreviewPackages(all, changedFiles())
  if (reason !== 'touched') console.error(REASON_MESSAGE[reason])
  for (const dir of packages) console.log(dir)
}

// Only when run as a script: importing this from a test must not enumerate the repository or shell
// out to git. The `resolve` + `fileURLToPath` pair is the idiom for that check; comparing strings by
// hand gets it wrong on a symlinked path.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
