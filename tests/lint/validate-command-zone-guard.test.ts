import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The write-in guard of the read-only study zone — layer 0 of `reference-provenance.md` § 2.
 *
 * ## What it protects, and the one case it got wrong
 *
 * The hook blocks commands that write INTO `knowledge-base/{references,tools}/`, so the zone stays
 * pristine third-party material. That is right, and every case below keeps it that way.
 *
 * The exception this file adds: **`git rm --cached`**. The blocking pattern lists `rm` among the
 * write verbs, so `git rm --cached <zone path>` matched it — but that command writes nothing to
 * disk. It removes a path from the git INDEX, which is the very thing § 1 demands ("never
 * versioned"). The guard was refusing the one operation that enforces the rule it exists to serve,
 * and ten zone paths sat tracked as submodule gitlinks because of it.
 *
 * The carve-out is deliberately narrow: only a lone `git rm --cached` invocation. A compound command
 * is still blocked, because `git rm --cached x && rm -rf <zone>` would otherwise smuggle a real
 * deletion past the guard on the strength of its harmless first half.
 */

const HOOK = resolve(__dirname, '../../.claude/hooks/validate-command.sh')
const PROJECT_DIR = resolve(__dirname, '../..')

/** Run the hook against a candidate command. `blocked` mirrors the PreToolUse exit-2 contract. */
function runHook(command: string): { blocked: boolean; stderr: string } {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
  })
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- runs the repo's own hook under bash
  const res = execFileSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_DIR },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return { blocked: false, stderr: res }
}

function hookVerdict(command: string): { blocked: boolean; stderr: string } {
  try {
    return runHook(command)
  } catch (err) {
    const e = err as { status?: number; stderr?: string }
    return { blocked: e.status === 2, stderr: e.stderr ?? '' }
  }
}

describe('write-in guard — what must stay blocked', () => {
  it('test_a_shell_rm_into_the_zone_is_blocked', () => {
    const v = hookVerdict('rm -rf .claude/knowledge-base/references/astro')
    expect(v.blocked).toBe(true)
    expect(v.stderr).toMatch(/read-only study material/)
  })

  it('test_a_copy_into_the_zone_is_blocked', () => {
    expect(hookVerdict('cp foo.ts .claude/knowledge-base/references/astro/foo.ts').blocked).toBe(
      true,
    )
  })

  it('test_a_redirect_into_the_zone_is_blocked', () => {
    expect(hookVerdict('echo hi > .claude/knowledge-base/references/astro/note.md').blocked).toBe(
      true,
    )
  })

  it('test_git_rm_WITHOUT_cached_is_blocked', () => {
    // This one DOES delete from the working tree. The carve-out below must not reach it.
    expect(hookVerdict('git rm -r .claude/knowledge-base/references/astro').blocked).toBe(true)
  })

  it('test_git_rm_cached_smuggling_a_real_deletion_is_blocked', () => {
    // The reason the carve-out is restricted to a LONE invocation: a compound command would
    // otherwise ride in on the harmless half.
    expect(
      hookVerdict(
        'git rm --cached .claude/knowledge-base/references/astro && rm -rf .claude/knowledge-base/references/hono',
      ).blocked,
    ).toBe(true)
  })
})

describe('write-in guard — the carve-out that enforces the rule', () => {
  it('test_a_lone_git_rm_cached_is_allowed', () => {
    // Removes the path from the INDEX and touches nothing on disk. `reference-provenance.md` § 1
    // requires exactly this: the zone is never versioned.
    const v = hookVerdict('git rm --cached .claude/knowledge-base/references/astro')
    expect(v.blocked, v.stderr).toBe(false)
  })

  it('test_a_lone_git_rm_cached_with_flags_is_allowed', () => {
    expect(hookVerdict('git rm --cached -q .claude/knowledge-base/references/astro').blocked).toBe(
      false,
    )
  })

  it('test_reading_the_zone_stays_allowed', () => {
    // Reading is the entire purpose of the zone; the guard has never blocked it and must not start.
    expect(hookVerdict('grep -rn "foo" .claude/knowledge-base/references/astro').blocked).toBe(
      false,
    )
  })
})
