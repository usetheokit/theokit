import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, onTestFinished } from 'vitest'
import { rmSync } from 'node:fs'

import { orderedPermissionRules } from '../../src/composition/agent-spec.js'

/**
 * #736 — an explicit `deny` must win, whichever layer wrote it and whichever layer allowed the tool.
 *
 * `PermissionEngine` is FIRST-MATCH-WINS, measured directly against the SDK: an engine built from
 * `[allow Read, deny Read]` evaluates `allow`, and the same pair reversed evaluates `deny`. So the
 * order the layers are concatenated in decides the outcome, and nothing was ordering them.
 *
 * The cost was measured on the built binary 2026-09-17, with `~/.claude/settings.json` carrying
 * `allow: [… "Read" …]` — 40 entries an operator had accumulated — and a project `settings.json`
 * carrying `deny: ["Read(./off-limits.txt)"]`. The file's contents came back. `update_plan`, denied
 * by the same project file and named in no allow list anywhere, was blocked correctly, which is what
 * made the defect look like a per-tool problem for most of the investigation.
 *
 * Deny-first is right in BOTH directions, and that is why it is the rule rather than a layer
 * precedence: a repository must not be able to grant itself what the operator refused, and an
 * operator's broad convenience allow must not silently disarm a refusal the repository wrote about
 * its own files. It is the same asymmetry `security-floor.ts` already encodes for `sandbox_mode` and
 * `approval_policy` — a layer may harden, never loosen.
 */
describe('a deny rule', () => {
  it('test_it_wins_over_an_allow_written_in_another_layer', () => {
    const cwd = workspace({ allow: ['Read'], deny: [] }, { allow: [], deny: ['Read'] })

    const rules = orderedPermissionRules(cwd, cwd)
    const firstForRead = rules.find((r) => r.tool === 'Read')

    expect(firstForRead?.action, 'the first Read rule the engine sees decides, and it must be the deny').toBe('deny')
  })

  it('test_an_allow_still_reaches_the_engine', () => {
    // The control: ordering must not DROP the allows, only place them after the denies. Without this,
    // "deny wins" could be satisfied by an engine that had stopped carrying permissions at all.
    const cwd = workspace({ allow: ['Glob'], deny: [] }, { allow: [], deny: ['Read'] })

    const rules = orderedPermissionRules(cwd, cwd)

    expect(rules.filter((r) => r.action === 'allow').map((r) => r.tool)).toContain('Glob')
    expect(rules.filter((r) => r.action === 'deny').map((r) => r.tool)).toContain('Read')
  })
})

function workspace(
  user: { allow: string[]; deny: string[] },
  project: { allow: string[]; deny: string[] },
): string {
  const dir = mkdtempSync(join(tmpdir(), 'deny-wins-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, '.claude'), { recursive: true })
  // Both layers resolve to the same directory in this fixture, so the two files are the two layers.
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: project }))
  writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: user }))
  return dir
}
