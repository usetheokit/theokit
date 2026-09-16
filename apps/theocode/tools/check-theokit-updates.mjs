#!/usr/bin/env node
/**
 * What is out of date in the `@theokit/*` dependencies this repository declares.
 *
 * WHY THIS FILE EXISTS RATHER THAN A CALL TO `pnpm outdated`.
 *
 * `pnpm outdated` is the right tool and it does not answer this question. Measured on pnpm 11.22.0,
 * 2026-08-25, in this repository:
 *
 *     pnpm outdated -r          -> 8 rows, every one of them a root `devDependencies` entry
 *     pnpm outdated -r --prod   -> empty
 *     pnpm --filter @theocode/agent outdated  -> empty
 *
 * The `@theokit/*` packages are `dependencies` of the four workspace packages, so all of them fall
 * in the half that reports nothing — `@theokit/agents` sat at 10.1.0 with 11.0.0 published and the
 * command said the tree was current. That is worse than no command: a check that reports clean
 * when it cannot see is believed.
 *
 * So the registry lookup is delegated (`pnpm view`, one process per package — not a hand-rolled
 * registry client), and what this file owns is the part that was missing: enumerating every
 * manifest in the workspace, including the ones `outdated` skips.
 *
 * Exit codes are for a human and for CI both: 0 = everything current, 1 = an update exists, 2 = the
 * check could not run. Never 0 on an error — see `rules/error-handling.md` § 1.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCOPE = '@theokit/'
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Every manifest this workspace owns: the root plus each `packages/*`. */
function manifests() {
  const found = [{ label: 'theocode (root)', path: join(ROOT, 'package.json') }]
  const packagesDir = join(ROOT, 'packages')
  if (!existsSync(packagesDir)) {
    throw new Error(`no packages/ directory at ${packagesDir} — is this the repository root?`)
  }
  for (const entry of readdirSync(packagesDir).sort()) {
    const path = join(packagesDir, entry, 'package.json')
    if (existsSync(path)) found.push({ label: `packages/${entry}`, path })
  }
  return found
}

/** Every `@theokit/*` range declared anywhere, with who declares it. */
function declaredRanges() {
  const byPackage = new Map()
  // One place records how a declaration is accumulated — the entry shape lives here and nowhere
  // else, so a change to it is made once.
  const record = (name, label, field, range) => {
    if (!name.startsWith(SCOPE)) return
    const entry = byPackage.get(name) ?? { name, declarations: [] }
    entry.declarations.push({ label, field, range })
    byPackage.set(name, entry)
  }
  for (const { label, path } of manifests()) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    for (const field of DEP_FIELDS) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        record(name, label, field, range)
      }
    }
    // `overrides` pins a transitive version and is a declaration like any other: it is the reason
    // `@theokit/presenter` is at 0.7.0, and a reader who saw only `packages/cli` would not know it.
    for (const [name, range] of Object.entries(manifest.overrides ?? {})) {
      record(name, label, 'overrides', range)
    }
  }
  return [...byPackage.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * What is on disk right now — the answer `pnpm outdated` calls `current`.
 *
 * Read from the manifest the installer linked into the declaring package, not through
 * `require.resolve`: this repository is ESM and the resolver would have to be given a base URL that
 * differs per workspace. The link is what the package actually loads, so reading it asks the
 * question directly.
 */
function installedVersion(name, label) {
  const dir = label.startsWith('packages/') ? label.slice('packages/'.length) : '.'
  const manifest = join(ROOT, dir === '.' ? '.' : join('packages', dir), 'node_modules', name, 'package.json')
  if (!existsSync(manifest)) return undefined
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version
  } catch {
    return undefined
  }
}

/** The one version every declaration of `name` resolved to, or the disagreement if they differ. */
function installedAcross(declarations, name) {
  const seen = new Map()
  for (const d of declarations) {
    const version = installedVersion(name, d.label)
    if (version === undefined) continue
    const who = seen.get(version) ?? []
    who.push(d.label)
    seen.set(version, who)
  }
  if (seen.size === 0) return { version: undefined, split: false }
  if (seen.size === 1) return { version: [...seen.keys()][0], split: false }
  // Two workspaces on different versions of the same package is worth SAYING rather than
  // collapsing to whichever was read first — it is how a surface ends up compiled against a
  // contract the other one does not have.
  return {
    version: [...seen.entries()].map(([v, who]) => `${v} (${who.join(', ')})`).join(' / '),
    split: true,
  }
}

/**
 * Which dist-tag a package is tracked on here, read from the version ON DISK (#73).
 *
 * Not configured anywhere: a repository that pins a prerelease has already said which channel it
 * follows, and asking it to say so a second time is a second place to drift.
 */
export function channelFor(installed) {
  if (installed === undefined) return 'latest'
  return installed.includes('-') ? 'next' : 'latest'
}

/**
 * The version this row should compare against, and the channel it came from.
 *
 * The channel travels WITH the number because a version with no channel beside it is the ambiguity
 * that produced #73: the row read `4.63.4` while we were deliberately on `5.0.0-next.1`, and nothing
 * said which question that number answered.
 *
 * A package with no `next` tag falls back to `latest`. Most `@theokit/*` packages publish no
 * prerelease, and reporting them as unknown would turn four correct rows into four question marks.
 */
export function publishedFor(installed, tags) {
  const channel = channelFor(installed)
  const version = tags[channel] ?? tags.latest
  return { version, channel: tags[channel] === undefined ? 'latest' : channel }
}

/**
 * The published dist-tags, via npm — the registry client is not reimplemented here (Rule 9).
 *
 * `npm view <name> dist-tags --json` rather than `pnpm view <name> version`: the second resolves
 * `latest` and nothing else, which is exactly the blind spot #73 reports. One call returns the whole
 * map, so reading a second channel costs no extra request.
 */
function publishedTags(name) {
  const out = execFileSync('npm', ['view', name, 'dist-tags', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const parsed = JSON.parse(out.trim())
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.latest !== 'string') {
    throw new Error(`\`npm view ${name} dist-tags\` returned no \`latest\``)
  }
  return parsed
}

function majorOf(version) {
  return Number(version.split('.')[0])
}

/** Ask the registry about every declared dependency; collect rows and per-package failures. */
function collectRows() {
  const rows = []
  const failures = []

  for (const { name, declarations } of declaredRanges()) {
    const { version: installed, split } = installedAcross(declarations, name)
    let latest
    let channel
    try {
      // #73 — the channel comes from what is INSTALLED, so a repository tracking prereleases is
      // compared against the versions it actually wants. Comparing against `latest` reported us
      // behind a version we had deliberately declined, and hid two prereleases we needed.
      const resolved = publishedFor(installed, publishedTags(name))
      latest = resolved.version
      channel = resolved.channel
    } catch (err) {
      failures.push({ name, reason: err instanceof Error ? err.message : String(err) })
      continue
    }
    rows.push({
      name,
      installed: installed ?? '(not installed)',
      latest,
      channel,
      // A major bump is called out because it is the one that cannot be taken by editing a caret:
      // it is a migration, and it needs the suite run against it before anyone believes it.
      split,
      major: !split && installed !== undefined && majorOf(latest) > majorOf(installed),
      current: !split && installed === latest,
      declarations,
    })
  }

  return { rows, failures }
}

/** Human table rendering — a distinct reason to change from the fetching above. */
function renderTable(rows, failures) {
  const width = (pick) => Math.max(...rows.map((r) => pick(r).length), 0)
  const nameWidth = Math.max(width((r) => r.name), 'package'.length)
  const installedWidth = Math.max(width((r) => r.installed), 'installed'.length)
  const latestWidth = Math.max(width((r) => r.latest), 'published'.length)
  // The channel is printed BESIDE the number, because a version with no channel is the ambiguity
  // #73 reports: the reader cannot tell which question the number answered.
  const channelWidth = Math.max(width((r) => r.channel ?? 'latest'), 'tag'.length)

  process.stdout.write(
    `${'package'.padEnd(nameWidth)}  ${'installed'.padEnd(installedWidth)}  ${'published'.padEnd(latestWidth)}  ${'tag'.padEnd(channelWidth)}  declared by\n`,
  )
  for (const row of rows) {
    const mark = row.split ? '><' : row.current ? '  ' : row.major ? '!!' : ' →'
    const where = row.declarations
      .map((d) => `${d.label} ${d.range}${d.field === 'overrides' ? ' (override)' : ''}`)
      .join(', ')
    process.stdout.write(
      `${row.name.padEnd(nameWidth)}  ${row.installed.padEnd(installedWidth)}  ${row.latest.padEnd(latestWidth)}  ${(row.channel ?? 'latest').padEnd(channelWidth)}  ${mark} ${where}\n`,
    )
  }
  const behind = rows.filter((r) => !r.current)
  process.stdout.write(
    behind.length === 0
      // "on the tag it tracks", not "at latest": since #73 a prerelease pin is compared against
      // `next`, and saying `latest` there would be the same wrong claim in the summary line.
      ? `\nEvery @theokit/* dependency is current on the tag it tracks.\n`
      : `\n${behind.length} of ${rows.length} behind. \`!!\` is a MAJOR — read its changelog and run the suite before taking it.\n`,
  )
  for (const f of failures) process.stderr.write(`could not check ${f.name}: ${f.reason}\n`)
}

function main() {
  const { rows, failures } = collectRows()

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ rows, failures }, null, 2)}\n`)
  } else {
    renderTable(rows, failures)
  }

  if (failures.length > 0) process.exit(2)
  process.exit(rows.some((r) => !r.current) ? 1 : 0)
}

// Guarded, so importing this file for its rules does not run the whole check. Without it the first
// `import` in a test exits the process — which is how this file went untested while it decided
// whether anyone was told a dependency had moved.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch (err) {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(2)
  }
}
