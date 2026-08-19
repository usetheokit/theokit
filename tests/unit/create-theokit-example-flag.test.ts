/**
 * `--example` must not promise a registry that does not exist (theokit#315).
 *
 * ## The failure this exists to catch
 *
 * `cloneExample` treated a bare name as a directory inside
 * `github.com/usetheodev/theokit-examples`, and on failure told the user to browse that
 * repository. It returns 404 under BOTH orgs and always has — the path was written in
 * anticipation of a repository nobody ever published. So the first thing a new user met on
 * `create-theokit my-app --example=blog` was a `degit` failure followed by a dead link.
 *
 * The URL form (`--example=https://github.com/user/repo`) works and is untouched. What is
 * removed is the fiction: a bare name now fails immediately, saying what IS supported,
 * instead of shelling out to a repository that cannot answer.
 *
 * @internal
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cloneExample } from '../../packages/create-theokit/src/clone-example.js'

const SRC_DIR = join(process.cwd(), 'packages/create-theokit/src')

describe('create-theokit --example (theokit#315)', () => {
  it('rejects a bare example name instead of cloning from a registry that does not exist', () => {
    expect(() => cloneExample('blog', '/tmp/theokit-315-should-not-be-created')).toThrow(
      /full GitHub URL/i,
    )
  })

  it('does not cite the non-existent examples repository in its failure message', () => {
    let message = ''
    try {
      cloneExample('blog', '/tmp/theokit-315-should-not-be-created')
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).not.toContain('theokit-examples')
  })

  it('leaves no reference to the dead examples repository anywhere in the CLI source', () => {
    const sources = readdirSync(SRC_DIR)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(SRC_DIR, f), 'utf-8'))
    expect(sources.join('\n')).not.toContain('theokit-examples')
  })
})
