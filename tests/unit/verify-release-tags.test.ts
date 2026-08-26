/**
 * The release guard also checks that the TAGS exist (usetheokit/theokit#504).
 *
 * On 2026-08-26 run `32924724608` published `theokit@0.55.0` and `create-theokit@1.24.0` with
 * provenance, then failed pushing the tags with `remote: fatal error in commit_refs`. The run went
 * red — correctly, something did fail — and the red was indistinguishable from a run that published
 * nothing, which is the failure `verify-release-published` was written for. An operator reading it
 * would reasonably re-cut a release against a registry that already had the version.
 *
 * The guard's own message already assumed otherwise: *"This release wrote a CHANGELOG entry and a
 * tag for N package(s) that are not on the registry."* It had never checked the tag.
 *
 * So the guard now reports both axes, and they fail for different reasons with different advice —
 * the point is not to turn the run green, it is to make the red say which half broke.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts', 'verify-release-published.mjs')

interface Pkg {
  readonly dir: string
  readonly name: string
  readonly version: string
}

/**
 * A fixture repository, a fake `npm` and a fake `git`.
 *
 * `tags` is what the fake `git tag -l <name>@<version>` knows. Everything else mirrors the sibling
 * fixture in `verify-release-published.test.ts`, deliberately — the two guards share a script and
 * splitting their harnesses would let one drift from what the other exercises.
 */
function fixture(packages: readonly Pkg[], published: readonly string[], tags: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'theo-release-tags-'))
  for (const pkg of packages) {
    const dir = join(root, 'packages', pkg.dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: pkg.name, version: pkg.version }),
    )
  }

  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })

  const npm = join(bin, 'npm')
  writeFileSync(
    npm,
    `#!/bin/sh\ncase " ${published.join(' ')} " in\n  *" $2 "*) echo "\${2##*@}" ;;\n  *) echo "npm ERR! code E404" 1>&2; exit 1 ;;\nesac\n`,
    { mode: 0o755 },
  )
  chmodSync(npm, 0o755)

  const git = join(bin, 'git')
  // `git tag -l <pattern>` prints the tag when it exists and nothing when it does not — the exit
  // code is 0 either way, which is why the script must read stdout rather than the status.
  writeFileSync(
    git,
    `#!/bin/sh\nif [ "$1" = "tag" ]; then\n  case " ${tags.join(' ')} " in\n    *" $3 "*) echo "$3" ;;\n  esac\n  exit 0\nfi\nexit 0\n`,
    { mode: 0o755 },
  )
  chmodSync(git, 0o755)

  return { root, bin }
}

function run(f: { root: string; bin: string }) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: f.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ''}`,
      THEO_RELEASE_VERIFY_DELAYS_MS: '1,1,1,1',
    },
  })
}

const PKG: Pkg = { dir: 'theo', name: 'theokit', version: '0.55.0' }

describe('the release guard reports the tag, not only the registry', () => {
  it('passes when the package is published AND tagged', () => {
    const r = run(fixture([PKG], ['theokit@0.55.0'], ['theokit@0.55.0']))
    expect(r.status).toBe(0)
  })

  it('fails when published but NOT tagged, and says which half broke', () => {
    const r = run(fixture([PKG], ['theokit@0.55.0'], []))
    expect(r.status).not.toBe(0)
    const out = `${r.stdout}${r.stderr}`
    // The distinction this exists to make: the publish worked.
    expect(out).toMatch(/publish/i)
    expect(out).toMatch(/tag/i)
    // And it must NOT read as "nothing reached the registry", which is the other failure.
    expect(out).not.toMatch(/published nothing/i)
  })

  it('names the missing tag so it can be created by hand', () => {
    const r = run(fixture([PKG], ['theokit@0.55.0'], []))
    expect(`${r.stdout}${r.stderr}`).toContain('theokit@0.55.0')
  })

  it('a git that cannot answer is a warning, not a verdict', () => {
    // The first draft failed the run here, which is reporting a state nobody observed — the defect
    // this whole script exists to prevent, reproduced inside it. It also broke the sibling suite,
    // whose fixtures have no git at all.
    const f = fixture([PKG], ['theokit@0.55.0'], [])
    writeFileSync(join(f.bin, 'git'), `#!/bin/sh\necho "not a git repository" 1>&2\nexit 128\n`, {
      mode: 0o755,
    })
    chmodSync(join(f.bin, 'git'), 0o755)

    const r = run(f)
    expect(r.status, 'an unreadable tag must not fail the release').toBe(0)
    expect(`${r.stdout}${r.stderr}`).toMatch(/could not read the tag/i)
  })

  it('still fails when nothing was published, whatever the tags say', () => {
    // The original guard's case. A tag without a publish is the worse direction — it claims a
    // release that does not exist — so it cannot be allowed to mask the registry check.
    const r = run(fixture([PKG], [], ['theokit@0.55.0']))
    expect(r.status).not.toBe(0)
    expect(`${r.stdout}${r.stderr}`).toMatch(/NOT published/i)
  })
})
