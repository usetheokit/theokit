import { describe, expect, it } from 'vitest'

import { REGISTRY_TOOL_NAMES } from '../../src/tools/registry.js'

/**
 * A tool this product shares with Claude Code carries Claude Code's NAME for it.
 *
 * The permission block in `.claude/settings.json` addresses tools by name — `Bash(ls:*)`,
 * `Read(./src/**)` — and `permissionRulesFromSettings` passes that name straight through into the
 * rule it builds (`translate` returns `{ tool, action }`, no mapping). A rule naming `Bash` can only
 * ever match a tool named `Bash`.
 *
 * So the divergent names were not cosmetic: they were the reason a pasted `settings.json` addressed
 * nothing. Measured 2026-09-17 side by side — Claude Code refused a `deny` rule this product honoured
 * with the file's canary.
 *
 * Only tools with a REAL one-to-one counterpart are listed. `ApplyPatch`, `GitDiff`, `RepoStatus`,
 * `ViewImage` and `CurrentTime` keep their own names because inventing an equivalence would make a
 * pasted rule address the wrong capability — worse than addressing none.
 */
const SHARED_WITH_CLAUDE_CODE = {
  Bash: 'runs a shell command',
  Read: 'reads a file',
  Edit: 'edits a file in place',
  Grep: 'searches file contents',
} as const

describe('tool names', () => {
  // The declared list, which is also what `ToolRegistry` asserts each tool's own `name` against —
  // so a name here that the tool does not carry fails at construction with `tool_name_mismatch`.
  const names = (): readonly string[] => REGISTRY_TOOL_NAMES

  it('test_every_shared_tool_uses_the_foreign_name', () => {
    const registered = names()
    for (const [name, what] of Object.entries(SHARED_WITH_CLAUDE_CODE)) {
      expect(registered, `${name} — ${what}`).toContain(name)
    }
  })

  it('test_the_old_codex_names_are_gone', () => {
    // Both names cannot coexist: a rule written for one would silently miss the other, which is the
    // same ambiguity this change removes.
    const registered = names()
    for (const old of ['run_shell', 'read_file', 'edit_file', 'grep']) {
      expect(registered, `${old} should have been renamed`).not.toContain(old)
    }
  })

  it('test_tools_with_no_counterpart_keep_their_own_name', () => {
    // The control: this change is scoped to real equivalences, not a sweep.
    const registered = names()
    for (const own of ['ApplyPatch', 'GitDiff', 'RepoStatus', 'CurrentTime']) {
      expect(registered, `${own} has no Claude Code counterpart`).toContain(own)
    }
  })
})
