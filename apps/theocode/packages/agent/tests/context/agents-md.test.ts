/**
 * B-042 — the AGENTS.md import confinement holds against a symlink.
 *
 * `insideRoot` compares `relative(rootDir, target)` on a path built with `resolve()`, which does NOT
 * follow symlinks. A link INSIDE the project pointing anywhere on the filesystem therefore passes
 * the containment check as a string, and `readFileSync` then follows it out.
 *
 * The check exists, which means the threat was recognised: an untrusted repository must not be able
 * to pull arbitrary files into the agent's system prompt. It just did not hold in the case where
 * someone would try.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadAgentsMd } from '../../src/context/agents-md.js'

let root: string
let outside: string

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'theocode-agents-'))
  root = join(base, 'project')
  outside = join(base, 'outside')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'secret.md'), 'THE SECRET CONTENT')
})

afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true })
})

describe('B-042 — an import cannot escape the project root', () => {
  it('test_an_import_inside_the_project_is_expanded', () => {
    // Anti-vacuity floor: refusing every import would satisfy the assertions below.
    writeFileSync(join(root, 'shared.md'), 'SHARED GUIDANCE')
    writeFileSync(join(root, 'AGENTS.md'), 'see @shared.md')

    expect(loadAgentsMd(root, vi.fn())).toContain('SHARED GUIDANCE')
  })

  it('test_a_relative_escape_is_refused', () => {
    writeFileSync(join(root, 'AGENTS.md'), 'see @../outside/secret.md')

    expect(loadAgentsMd(root, vi.fn())).not.toContain('THE SECRET CONTENT')
  })

  it('test_a_symlink_out_of_the_project_is_refused', () => {
    // The path RESOLVES inside the project; only the link target is outside. `resolve()` does not
    // follow symlinks, so the containment check saw an inside path and let the read follow it out.
    symlinkSync(join(outside, 'secret.md'), join(root, 'looks-local.md'))
    writeFileSync(join(root, 'AGENTS.md'), 'see @looks-local.md')

    expect(
      loadAgentsMd(root, vi.fn()),
      'a symlink inside the project pulled a file from outside it into the system prompt',
    ).not.toContain('THE SECRET CONTENT')
  })
})
