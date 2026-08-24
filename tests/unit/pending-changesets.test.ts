/**
 * Deciding whether a release run must version or publish (usetheokit/theokit#191).
 *
 * The release workflow has two mutually exclusive branches: with pending changesets it produces the
 * "Version Packages" commit; without them it publishes. `changesets/action` decides that internally
 * and, on the version branch, tries to OPEN A PULL REQUEST — which this organization forbids
 * (`can_approve_pull_request_reviews=false`, measured across all ten repositories and the org).
 *
 * So the decision moves out of the action, and this is the decision. It is a script rather than a
 * shell one-liner in the YAML for one reason: a wrong answer here sends a release down the wrong
 * branch, and a shell glob that silently counts `README.md` would publish when it should version.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts', 'pending-changesets.mjs')

/** A repository whose `.changeset/` holds exactly these files. */
function fixture(files: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'theo-pending-changesets-'))
  mkdirSync(join(root, '.changeset'), { recursive: true })
  for (const name of files) writeFileSync(join(root, '.changeset', name), '---\n')
  return root
}

function run(root: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
}

describe('a repository with changesets waiting must version, not publish', () => {
  it('test_one_changeset_answers_true', () => {
    const out = run(fixture(['config.json', 'README.md', 'a-real-change.md']))

    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe('true')
  })
})

describe('a repository with nothing pending must publish', () => {
  it('test_only_the_scaffolding_answers_false', () => {
    // `README.md` and `config.json` ship with `.changeset/` and are not changesets. A glob that
    // counted them would send every run down the version branch, forever.
    const out = run(fixture(['config.json', 'README.md']))

    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe('false')
  })

  it('test_an_empty_changeset_directory_answers_false', () => {
    expect(run(fixture([])).stdout.trim()).toBe('false')
  })

  it('test_a_repository_with_no_changeset_directory_answers_false', () => {
    const root = mkdtempSync(join(tmpdir(), 'theo-no-changeset-'))

    // Not an error: a repository that does not use changesets simply has nothing pending.
    const out = run(root)
    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe('false')
  })
})

describe('the answer is exactly one word, because a workflow reads it', () => {
  it('test_stdout_carries_no_decoration', () => {
    const out = run(fixture(['x.md']))

    // The workflow assigns this straight into `$GITHUB_OUTPUT`. A banner line, a warning, or a
    // trailing space would make the comparison fail and the run take the wrong branch silently.
    expect(out.stdout).toBe('true\n')
    expect(out.stderr).toBe('')
  })
})
