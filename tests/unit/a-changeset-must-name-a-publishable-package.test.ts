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
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const REPO = process.cwd()
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
}

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

/** A committed repository carrying the script, the workspace and the given changesets. */
function fixture(spec: Fixture): string {
  const root = mkdtempSync(join(tmpdir(), 'theo-changeset-publishable-'))
  mkdirSync(join(root, 'scripts'))
  copyFileSync(SCRIPT, join(root, 'scripts', 'check-changeset-coverage.mjs'))
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
  for (const [name, text] of Object.entries(spec.changesets ?? {})) {
    write(root, join('.changeset', name), text)
  }
  for (const [path, text] of Object.entries(spec.files ?? {})) write(root, path, text)
  setup(root, ['init', '-q'])
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
    'fixture',
  ])
  return root
}

/** Base `HEAD`: the diff is empty, so only the changeset check can act. */
function run(root: string) {
  return spawnSync(
    process.execPath,
    [join(root, 'scripts', 'check-changeset-coverage.mjs'), 'HEAD'],
    {
      cwd: root,
      encoding: 'utf8',
      env: ENV,
    },
  )
}

const changeset = (body: string): string => `---\n${body}\n---\n\nA change.\n`

describe('a changeset that no release publishes is refused', () => {
  it('test_a_changeset_naming_only_a_private_package_is_refused_naming_file_and_package', () => {
    const out = run(fixture({ changesets: { 'private-only.md': changeset('"priv": patch') } }))

    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/\.changeset\/private-only\.md: names only priv \(private\)/)
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
    expect(out.stderr).toMatch(/mixed\.md: names .*ignored-app \(ignored\)/)
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
