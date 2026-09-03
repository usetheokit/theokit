import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { scaffold } from '../../src/index.js'

/**
 * A generated app must demonstrate all five TheoKit concepts, wired — not merely present.
 *
 * The distinction is the whole point of this file. A directory with a markdown file in it proves
 * nothing: `WEB_ONLY_FILES` and the `--bare` assertion both passed for months while pointing at
 * paths that had stopped meaning anything. So each concept is checked at the seam where it would
 * actually fail — the hook by its call site in the builder chain, the rules by the frontmatter the
 * SDK's parser requires, the personalities by the name the runtime looks them up under.
 *
 * The two halves this covers are structural: agents / tools / skills / hooks are CODE under
 * `src/server/`, while rules / personalities / context are DATA under `.theokit/`, edited without a
 * rebuild. An app that ships one half and not the other teaches half the framework.
 */
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'theokit-concepts-'))
  scaffold(dir, 'concepts-probe')
}, 30_000)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const read = (rel: string): string => readFileSync(join(dir, rel), 'utf-8')

describe('the code half — src/server/agents/', () => {
  it('ships an agent, a tool, a prompt and a skill', () => {
    for (const f of [
      'src/server/agents/chat.ts',
      'src/server/agents/tools/weather.ts',
      'src/server/agents/prompts/instructions.ts',
      'src/server/agents/skills/daily-briefing.ts',
    ]) {
      expect(existsSync(join(dir, f)), `${f} must exist`).toBe(true)
    }
  })

  it('ships a lifecycle hook that is actually attached to the agent', () => {
    expect(existsSync(join(dir, 'src/server/agents/hooks/tool-audit.ts'))).toBe(true)

    // The wiring, not the file. A hook nobody calls is the dead code this repo has a detector for,
    // and it would still satisfy an existsSync check.
    const chat = read('src/server/agents/chat.ts')
    expect(chat).toContain("from './hooks/tool-audit.js'")
    expect(chat).toMatch(/\.hooks\(toolAuditHooks\)/)
  })

  it('the hook observes rather than vetoes, and says so', () => {
    // `pre_tool_call` is the only hook with veto power. A template that shipped one would be
    // encoding a policy the app never chose — so the absence is deliberate and pinned here, next to
    // the reason, rather than left to be "fixed" by someone reading it as an omission.
    const hook = read('src/server/agents/hooks/tool-audit.ts')
    expect(hook).toContain('pre_tool_call')
    expect(hook).toContain('post_tool_call')

    // `block: true` DOES appear in the file — in the docblock, showing the reader the veto shape.
    // So the check is where it appears, line by line, rather than whether: every occurrence must be
    // inside the comment. Line prefixes instead of a regex because the pattern that distinguishes
    // "indented code" from "indented comment" is exactly the kind that backtracks.
    const vetoOutsideComments = hook
      .split('\n')
      .filter((line) => line.includes('block: true'))
      .filter((line) => !line.trimStart().startsWith('*'))

    expect(vetoOutsideComments, 'the shipped hook must observe, not decide').toEqual([])
  })
})

describe('the data half — .theokit/', () => {
  it('restores the dotfolder name (npm strips it in a published package)', () => {
    expect(existsSync(join(dir, '.theokit'))).toBe(true)
    expect(existsSync(join(dir, 'dot-theokit')), 'the prefixed name must not survive').toBe(false)
  })

  it('ships project context at the path the SDK reads', () => {
    // `.theokit/THEO.md`, cwd-only, priority 60 — measured from the SDK's own source table.
    expect(existsSync(join(dir, '.theokit/THEO.md'))).toBe(true)
  })

  it('ships a rule whose frontmatter the SDK parser accepts', () => {
    const rule = read('.theokit/rules/server-routes.md')
    // RulesFrontmatterSchema: description / paths / globs / alwaysApply / enabled. A rule with a
    // typo'd key silently becomes `alwaysApply: true` — always on, which is the opposite of scoped.
    expect(rule.startsWith('---\n')).toBe(true)
    expect(rule).toMatch(/^description: /m)
    expect(rule).toMatch(/^globs:/m)
    expect(rule).toMatch(/^\s+- src\/server\/routes\//m)
  })

  it('ships personalities whose `name` matches what usePersonality takes', () => {
    for (const name of ['concise', 'teacher']) {
      const body = read(`.theokit/personalities/${name}.md`)
      expect(body).toMatch(new RegExp(`^name: ${name}$`, 'm'))
      expect(body).toMatch(/^description: /m)
      // The body IS the system prompt, so an empty one is a preset that changes nothing.
      const afterFrontmatter = body.split(/^---$/m)[2] ?? ''
      expect(afterFrontmatter.trim().length).toBeGreaterThan(80)
    }
  })

  it('does not name a reserved personality', () => {
    // `none`, `default` and `neutral` CLEAR the active preset. A file with one of those names can
    // never be selected, and would look like a preset that silently does nothing.
    for (const reserved of ['none', 'default', 'neutral']) {
      expect(
        existsSync(join(dir, `.theokit/personalities/${reserved}.md`)),
        `${reserved} is reserved by the runtime`,
      ).toBe(false)
    }
  })
})
