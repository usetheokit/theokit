/**
 * A changeset that names only private or ignored packages is refused at the PR (B-658).
 *
 * Measured 2026-10-30 at `origin/main` `e155964`: `.changeset/theoclaw-pinned-deps.md` named only the
 * private `theoclaw` app, so the Release workflow took its version branch and `pnpm version-packages`
 * refused ("no package differs from origin/main"). Listing `theoclaw` in changesets `ignore` alone did
 * not help: the changeset stayed pending and the same refusal repeated. The one state that releases
 * is a trunk with no such changeset, so `scripts/check-changeset-coverage.mjs` refuses it in CI.
 *
 * The script resolves its root from its own location, so each case copies it into a temporary git
 * repository holding the workspace manifests and changesets the case needs.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

/** Resolved from this file, so the cases hold whatever directory the runner starts in. */
const REPO = resolve(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'check-changeset-coverage.mjs')

/**
 * The environment without `GIT_*`: run from a git hook, an inherited `GIT_DIR` or `GIT_INDEX_FILE`
 * would point the fixture's `git init` and `git commit` at this repository instead of the fixture.
 */
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))

const WORKSPACE = "packages:\n  - 'packages/*'\n  - 'apps/*'\n  - 'my-test'\n"
const MANIFESTS: Readonly<Record<string, object>> = {
  'packages/pub/package.json': { name: '@scope/pub', version: '1.0.0' },
  'packages/a/package.json': { name: '@scope/a', version: '1.0.0' },
  'apps/priv/package.json': { name: 'priv', version: '0.0.0', private: true },
  'apps/ignored/package.json': { name: 'ignored-app', version: '1.0.0' },
}

interface Fixture {
  readonly changesets?: Readonly<Record<string, string>>
  readonly ignore?: readonly string[]
  readonly config?: string
  readonly workspace?: string
  readonly files?: Readonly<Record<string, string>>
  /** Files committed in a second commit, so the range from the first commit carries them. */
  readonly changed?: Readonly<Record<string, string>>
}

/** Every fixture root a case created, removed after it. */
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

function setup(root: string, args: readonly string[]): void {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
  const out = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: ENV })
  // A setup failure must read as one, not as the script's verdict (EC-3).
  expect(out.status, `fixture setup \`git ${args.join(' ')}\` failed: ${out.stderr}`).toBe(0)
}

/** Writes every `path -> text` entry of `files` under `root`. */
function writeAll(root: string, files: Readonly<Record<string, string>> = {}): void {
  for (const [path, text] of Object.entries(files)) write(root, path, text)
}

/** The workspace, its manifests and the changesets config every fixture starts from. */
function writeWorkspace(root: string, spec: Fixture): void {
  write(root, 'pnpm-workspace.yaml', spec.workspace ?? WORKSPACE)
  for (const [path, manifest] of Object.entries(MANIFESTS)) {
    write(root, path, JSON.stringify(manifest))
  }
  write(
    root,
    '.changeset/config.json',
    spec.config ?? JSON.stringify({ baseBranch: 'main', ignore: spec.ignore ?? [] }),
  )
  write(root, '.changeset/README.md', '# Changesets\n')
}

/** A committed repository carrying the script, the workspace and the given changesets. */
function fixture(spec: Fixture): string {
  const root = mkdtempSync(join(tmpdir(), 'theo-changeset-publishable-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'))
  copyFileSync(SCRIPT, join(root, 'scripts', 'check-changeset-coverage.mjs'))
  writeWorkspace(root, spec)
  for (const [name, text] of Object.entries(spec.changesets ?? {})) {
    write(root, join('.changeset', name), text)
  }
  writeAll(root, spec.files)
  setup(root, ['init', '-q'])
  commit(root, 'fixture')
  if (spec.changed !== undefined) {
    writeAll(root, spec.changed)
    commit(root, 'change')
  }
  return root
}

function commit(root: string, message: string): void {
  setup(root, ['add', '-A'])
  setup(root, [
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    message,
  ])
}

/**
 * Base `HEAD` empties the diff, so only the changeset check can act; base `HEAD~1` puts the
 * fixture's `changed` files in the range, so the coverage check acts too.
 */
function run(root: string, base = 'HEAD'): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [join(root, 'scripts', 'check-changeset-coverage.mjs'), base],
    {
      cwd: root,
      encoding: 'utf8',
      env: ENV,
    },
  )
}

const SRC_CHANGE = { 'packages/pub/src/x.ts': 'export const x = 1\n' }

const changeset = (body: string): string => `---\n${body}\n---\n\nA change.\n`

describe('a changeset that no release publishes is refused', () => {
  it('test_a_changeset_naming_only_a_private_package_is_refused_naming_file_and_package', () => {
    const out = run(fixture({ changesets: { 'private-only.md': changeset('"priv": patch') } }))

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/\.changeset\/private-only\.md: names only priv \(private\)/)
    expect(out.stderr).toMatch(/Record the change in that package's CHANGELOG/)
    expect(out.stderr).toMatch(/delete the changeset/)
  })

  it('test_a_changeset_naming_only_an_ignored_package_is_refused', () => {
    const out = run(
      fixture({
        ignore: ['ignored-app'],
        changesets: { 'ignored-only.md': changeset('"ignored-app": minor') },
      }),
    )

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/ignored-only\.md: names only ignored-app \(ignored\)/)
  })

  it('test_an_ignore_glob_refuses_a_changeset_naming_a_package_it_matches', () => {
    const out = run(
      fixture({ ignore: ['@scope/*'], changesets: { 'glob.md': changeset('"@scope/a": patch') } }),
    )

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/glob\.md: names only @scope\/a \(ignored\)/)
  })

  it('test_an_ignored_package_beside_a_publishable_one_is_refused', () => {
    // EC-1: the changesets CLI refuses a mixed changeset inside the Release workflow on `main`.
    const out = run(
      fixture({
        ignore: ['ignored-app'],
        changesets: { 'mixed.md': changeset('"ignored-app": patch\n"@scope/pub": patch') },
      }),
    )

    expect(out.status, out.stderr).toBe(1)
    const line = out.stderr.split('\n').find((l) => l.includes('mixed.md')) ?? ''
    // The changeset also names a package a release publishes: it is not "only" the ignored one,
    // and deleting it would drop @scope/pub's release note (F-dom-1).
    expect(line).toMatch(
      /mixed\.md: names ignored-app \(ignored\) beside a package a release publishes/,
    )
    expect(line).not.toMatch(/\bonly\b/)
    expect(out.stderr).toMatch(/remove the ignored package's line/)
    expect(out.stderr).not.toMatch(/delete the changeset/)
  })

  it('test_an_ignored_and_a_private_package_together_are_both_named', () => {
    const out = run(
      fixture({
        ignore: ['ignored-app'],
        changesets: { 'unpub.md': changeset('"ignored-app": patch\n"priv": patch') },
      }),
    )

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(
      /unpub\.md: names ignored-app \(ignored\), priv \(private\), which no release publishes/,
    )
  })

  it('test_an_unquoted_key_naming_only_a_private_package_is_refused', () => {
    // EC-2: changesets accepts an unquoted key, so the guard must read one.
    const out = run(fixture({ changesets: { 'unquoted.md': changeset('priv: patch') } }))

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/unquoted\.md: names only priv \(private\)/)
  })

  it('test_a_key_carrying_a_yaml_comment_is_still_read', () => {
    const out = run(fixture({ changesets: { 'comment.md': changeset('priv: patch # pinned') } }))

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/comment\.md: names only priv \(private\)/)
  })

  it('test_a_crlf_changeset_naming_only_a_private_package_is_refused', () => {
    const crlf = '---\r\n"priv": none\r\n---\r\n\r\nA change.\r\n'
    const out = run(fixture({ changesets: { 'crlf.md': crlf } }))

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/crlf\.md: names only priv \(private\)/)
  })

  it('test_a_hash_inside_a_quoted_bump_is_not_read_as_a_comment', () => {
    const out = run(fixture({ changesets: { 'quoted.md': changeset('"priv": "patch" # "x#y"') } }))

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/quoted\.md: names only priv \(private\)/)
  })
})

describe('a changeset some release publishes still passes', () => {
  it('test_a_changeset_naming_a_publishable_package_passes', () => {
    const out = run(fixture({ changesets: { 'pub.md': changeset('"@scope/pub": patch') } }))

    expect(out.status, out.stderr).toBe(0)
  })

  it('test_a_private_package_beside_a_publishable_one_passes', () => {
    const out = run(
      fixture({ changesets: { 'both.md': changeset('"priv": patch\n"@scope/pub": minor') } }),
    )

    expect(out.status, out.stderr).toBe(0)
  })

  it('test_a_changeset_that_names_no_package_passes', () => {
    // EC-4: an empty changeset releases nothing and stops nothing.
    const out = run(fixture({ changesets: { 'empty.md': '---\n\n---\n\nNothing to release.\n' } }))

    expect(out.status, out.stderr).toBe(0)
  })
})

describe('what the check cannot read is never a pass', () => {
  it('test_a_package_no_workspace_manifest_declares_exits_2', () => {
    const out = run(fixture({ changesets: { 'typo.md': changeset('"@scope/nope": patch') } }))

    expect(out.status, out.stderr).toBe(2)
    expect(out.stderr).toMatch(/typo\.md names @scope\/nope, which no workspace package declares/)
  })

  it('test_a_frontmatter_line_it_cannot_parse_exits_2_naming_file_and_line', () => {
    const out = run(fixture({ changesets: { 'list.md': changeset('- priv') } }))

    expect(out.status, out.stderr).toBe(2)
    expect(out.stderr).toMatch(/list\.md.*- priv/)
  })

  it('test_a_config_that_does_not_parse_exits_2_naming_it', () => {
    const out = run(
      fixture({
        config: '{ "ignore": [',
        changesets: { 'pub.md': changeset('"@scope/pub": patch') },
      }),
    )

    expect(out.status, out.stderr).toBe(2)
    expect(out.stderr).toMatch(/\.changeset\/config\.json/)
  })

  it('test_an_unsupported_workspace_glob_exits_2_naming_the_entry', () => {
    const out = run(
      fixture({
        workspace: "packages:\n  - 'packages/*'\n  - 'apps/**'\n",
        changesets: { 'pub.md': changeset('"@scope/pub": patch') },
      }),
    )

    expect(out.status, out.stderr).toBe(2)
    expect(out.stderr).toMatch(/apps\/\*\*/)
  })

  it('test_an_ignore_entry_with_a_glob_shape_it_cannot_match_exits_2_naming_it', () => {
    // F-arch-2: changesets reads `ignore` with micromatch; a shape this check cannot match would
    // let a changeset naming that package pass silently, so it is refused like a workspace glob.
    const out = run(
      fixture({
        ignore: ['@scope/{a,pub}'],
        changesets: { 'pub.md': changeset('"@scope/pub": patch') },
      }),
    )

    expect(out.status, out.stderr).toBe(2)
    expect(out.stderr).toMatch(/@scope\/\{a,pub\}/)
  })

  it('test_a_changed_package_manifest_that_does_not_parse_exits_2_naming_it', () => {
    // F-arch-1: a broken manifest is the check failing to run (2), not a coverage refusal (1).
    const out = run(
      fixture({
        files: { 'packages/pub/package.json': '{ "name": ' },
        changed: SRC_CHANGE,
      }),
      'HEAD~1',
    )

    expect(out.status, out.stderr).toBe(2)
    expect(out.stderr).toMatch(/packages\/pub\/package\.json/)
  })

  it('test_a_workspace_manifest_that_does_not_parse_exits_2_naming_it', () => {
    const out = run(
      fixture({
        files: { 'apps/broken/package.json': '{ "name": ' },
        changesets: { 'pub.md': changeset('"@scope/pub": patch') },
      }),
    )

    expect(out.status, out.stderr).toBe(2)
    expect(out.stderr).toMatch(/apps\/broken\/package\.json/)
  })
})

describe('a publishable package whose source changed needs a changeset', () => {
  it('test_a_source_change_with_no_changeset_is_refused_naming_the_package', () => {
    const out = run(fixture({ changed: SRC_CHANGE }), 'HEAD~1')

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/1 publishable package\(s\) changed/)
    expect(out.stderr).toMatch(/@scope\/pub {3}\(packages\/pub\/src\)/)
  })

  it('test_a_source_change_with_a_changeset_naming_the_package_passes', () => {
    const out = run(
      fixture({ changed: SRC_CHANGE, changesets: { 'pub.md': changeset('"@scope/pub": patch') } }),
      'HEAD~1',
    )

    expect(out.status, out.stderr).toBe(0)
    expect(out.stdout).toMatch(/1 publishable package\(s\) changed since HEAD~1, all declared/)
  })

  it('test_an_uncovered_change_and_a_private_only_changeset_are_both_reported', () => {
    const out = run(
      fixture({
        changed: SRC_CHANGE,
        changesets: { 'private-only.md': changeset('"priv": patch') },
      }),
      'HEAD~1',
    )

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/private-only\.md: names only priv \(private\)/)
    expect(out.stderr).toMatch(/@scope\/pub {3}\(packages\/pub\/src\)/)
  })

  it('test_an_ignored_package_whose_source_changed_needs_no_changeset', () => {
    // An ignored package is never versioned, so demanding a changeset for it while refusing every
    // changeset that names it would leave no tree that passes (LCR #73).
    const out = run(
      fixture({ ignore: ['@scope/a'], changed: { 'packages/a/src/x.ts': 'export const x = 1\n' } }),
      'HEAD~1',
    )

    expect(out.status, out.stderr).toBe(0)
    expect(out.stdout).toMatch(/0 publishable package\(s\) changed/)
  })
})

describe('this repository passes its own check', () => {
  it('test_this_repository_carries_no_changeset_that_only_a_private_or_ignored_package_names', () => {
    // Base `HEAD` empties the diff, so only the changeset refusal can fail this. It is the guard
    // that the trunk carries nothing the Release workflow would refuse on (B-658).
    const out = spawnSync(process.execPath, [SCRIPT, 'HEAD'], {
      cwd: REPO,
      encoding: 'utf8',
      env: ENV,
    })

    expect(out.status, out.stderr).toBe(0)
  })
})
