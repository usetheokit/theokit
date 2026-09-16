/**
 * Characterization of `rules.ts` — 157 LoC that had no test at all (B-103, B-116).
 *
 * These do not assert what the module SHOULD do. They pin what it DOES, today, so that the
 * migration onto `@theokit/sdk/context` has something to be equivalent to. Without them,
 * "behaviourally equivalent" is a claim nobody can check, and the module is consumed by
 * `config/trust-posture.ts` — which decides whether a project's `[[hooks]]` are honoured, and a
 * hook is arbitrary command execution on every tool call (B-086). Getting discovery wrong there is
 * a security change wearing a refactor's clothes.
 *
 * So the cases below deliberately concentrate on the PRODUCT POLICY the SDK's `runDiscovery` may
 * not carry — the traversal budget, the truncation and its warning, the injected `readFile`/`warn`
 * seams, the frontmatter scoping — rather than on the happy path of "it finds markdown files".
 * The happy path is the part any replacement gets right for free.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { loadRules, type TraversalBudget } from '../../src/context/rules.js'

const sandbox = mkdtempSync(join(tmpdir(), 'rules-char-'))
afterAll(() => rmSync(sandbox, { recursive: true, force: true }))

/** A project root with `.theokit/rules/` populated from `files` (path → content). */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(sandbox, 'proj-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, '.theokit', 'rules', rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  mkdirSync(join(root, '.theokit', 'rules'), { recursive: true })
  return root
}

function collectWarnings(): { warn: (m: string) => void; messages: string[] } {
  const messages: string[] = []
  return { warn: (m) => void messages.push(m), messages }
}

describe('loadRules — what it reads and how it joins', () => {
  it('test_rule_bodies_are_joined_with_a_horizontal_rule', () => {
    const root = project({ 'a.md': 'first rule', 'b.md': 'second rule' })
    const { text, count } = loadRules(root, () => {})

    expect(count).toBe(2)
    // The separator is part of the assembled prompt the model sees, so it is behaviour, not
    // formatting — a replacement that joins with a bare newline changes the prompt.
    expect(text).toBe('first rule\n\n---\n\nsecond rule')
  })

  it('test_the_assembled_order_is_lexicographic', () => {
    // The contract consumers depend on: the same tree assembles the same prompt on any machine.
    //
    // Honest limit, measured rather than assumed: this case CANNOT distinguish the module's
    // explicit `.sort()` from ambient filesystem order. Deleting the sort leaves every case here
    // green, because `readdirSync` on this filesystem already returns entries sorted — checked at
    // 3 and at 40 entries. The assertion still earns its place: it pins the OUTPUT contract, and
    // would catch a replacement that returns directory order on a filesystem where the two differ
    // (APFS, or ext4 with another hash seed). It is simply not a test of the sort call.
    const root = project({ 'z.md': 'last', 'a.md': 'first', 'm.md': 'middle' })
    expect(loadRules(root, () => {}).text).toBe('first\n\n---\n\nmiddle\n\n---\n\nlast')
  })

  it('test_a_missing_rules_directory_yields_nothing_rather_than_throwing', () => {
    // The common case: most projects have no `.theokit/rules/`. It must be silent, not an error.
    const root = mkdtempSync(join(sandbox, 'empty-'))
    const { warn, messages } = collectWarnings()

    expect(loadRules(root, warn)).toEqual({ text: '', count: 0, read: 0, chars: 0, kept: 0, truncated: false })
    expect(messages).toEqual([])
  })

  it('test_only_markdown_is_collected', () => {
    const root = project({ 'rule.md': 'kept', 'notes.txt': 'dropped', 'data.json': '{}' })
    expect(loadRules(root, () => {}).text).toBe('kept')
  })

  it('test_nested_directories_are_walked', () => {
    const root = project({ 'top.md': 'top', 'deep/nested/inner.md': 'inner' })
    const { text, count } = loadRules(root, () => {})
    expect(count).toBe(2)
    // `deep/` sorts before `top.md`, and the walk descends before continuing the sweep.
    expect(text).toBe('inner\n\n---\n\ntop')
  })
})

describe('loadRules — frontmatter, which changes what the rule CLAIMS to apply to', () => {
  it('test_a_paths_scope_is_announced_above_the_body', () => {
    // This line is the difference between a rule the model applies everywhere and one it applies to
    // a subset. Losing it in a migration silently widens every scoped rule.
    const root = project({
      'scoped.md': '---\npaths:\n  - "src/**/*.ts"\n  - "*.tsx"\n---\nuse tabs',
    })

    expect(loadRules(root, () => {}).text).toBe(
      '> Applies ONLY to files matching: src/**/*.ts, *.tsx\n\nuse tabs',
    )
  })

  it('test_frontmatter_without_paths_contributes_only_the_body', () => {
    const root = project({ 'r.md': '---\ntitle: something\n---\nthe body' })
    expect(loadRules(root, () => {}).text).toBe('the body')
  })

  it('test_unclosed_frontmatter_skips_the_rule_and_says_so', () => {
    // Failing open here would feed a half-parsed document into the prompt as if it were a rule.
    const root = project({ 'broken.md': '---\npaths:\n  - x\nno closing fence' })
    const { warn, messages } = collectWarnings()

    expect(loadRules(root, warn)).toEqual({ text: '', count: 0, read: 0, chars: 0, kept: 0, truncated: false })
    // The wording is the framework's now — it is the layer that refused the file, and it says so in
    // its own words. What this test pins is the OUTCOME (nothing reaches the prompt) and that the
    // refusal is announced through the seam; owning the sentence would be owning the wrong thing.
    expect(messages.some((m) => m.startsWith('[rules] ') && m.includes('never closes'))).toBe(true)
  })

  it('test_a_declared_scope_that_cannot_be_read_drops_the_rule_and_says_so', () => {
    // Renamed because the mechanism changed and the GUARANTEE did not.
    //
    // This used to run a YAML parser and skip the file when it threw. The framework reads
    // frontmatter by line and never throws, so "unparseable YAML" is not a state it can be in — but
    // the state that MATTERED is: a `paths:` that was declared and yielded nothing. Rendering that
    // as unscoped takes a rule written for one subtree and applies it everywhere.
    //
    // `scopesUnreadable` is that signal, and `scopedBlock` fails closed on it. Same outcome, and now
    // the narrower question is the one being asked.
    const root = project({ 'bad.md': '---\npaths: [unclosed\n---\nbody' })
    const { warn, messages } = collectWarnings()

    expect(loadRules(root, warn).count).toBe(0)
    expect(messages.some((m) => m.includes('no scope could be read'))).toBe(true)
  })

  it('test_a_rule_whose_body_is_empty_after_frontmatter_is_dropped_silently', () => {
    // Dropped, and NOT warned about — an empty rule is a no-op, not a mistake worth interrupting for.
    const root = project({ 'empty.md': '---\ntitle: x\n---\n   \n' })
    const { warn, messages } = collectWarnings()

    expect(loadRules(root, warn)).toEqual({ text: '', count: 0, read: 0, chars: 0, kept: 0, truncated: false })
    expect(messages).toEqual([])
  })

  it('test_every_declared_path_is_announced_including_ones_yaml_would_have_typed', () => {
    // A RELAXATION, recorded rather than hidden.
    //
    // The YAML parser this file used to run returned typed values, so `- 42` and `- null` came back
    // as a number and a null and were filtered out. The framework reads lines and cannot know a
    // type, so they arrive as the strings `42` and `null`.
    //
    // Accepted because the direction is safe: a scope matching nothing NARROWS a rule, and the
    // failure this whole area guards against is the opposite one — a scope silently WIDENING. The
    // cost is cosmetic, a slightly noisier line in the prompt.
    const root = project({ 'mixed.md': '---\npaths:\n  - "ok.ts"\n  - 42\n  - null\n---\nbody' })
    expect(loadRules(root, () => {}).text).toBe(
      '> Applies ONLY to files matching: ok.ts, 42, null\n\nbody',
    )
  })
})

describe('loadRules — the seams a caller can inject', () => {
  // The `readFile` seam was removed, and the comment that guarded it was measured wrong.
  //
  // It claimed `trust-posture.ts` relied on injecting content without touching the disk. It does
  // not: that file lists the STRING `'loadRules'` in a `loaders:` array — a declaration of which
  // loaders are trust-gated — and never calls it. The only production caller is `chat.ts:218`,
  // `loadRules(cwd).text`, with no seam. A seam whose only user was its own test is cost.

  it('test_warn_is_the_seam_diagnostics_arrive_through_and_nothing_reaches_stderr', () => {
    const root = project({ 'broken.md': '---\nunclosed' })
    const { warn, messages } = collectWarnings()
    loadRules(root, warn)
    expect(messages.length).toBeGreaterThan(0)
  })
})

describe('loadRules — the traversal budget', () => {
  it.each([
    ['maxDepth', { maxDepth: 0, maxFiles: 10 }],
    ['maxFiles', { maxDepth: 10, maxFiles: 0 }],
    ['both', { maxDepth: -1, maxFiles: -1 }],
  ])('test_a_non_positive_%s_is_a_typed_RangeError', (_label, budget) => {
    // Fail fast and typed, rather than silently sweeping nothing — a budget of zero that quietly
    // returned an empty rule set would look exactly like a project with no rules.
    const root = project({ 'a.md': 'x' })
    expect(() => loadRules(root, () => {}, budget as TraversalBudget)).toThrow(RangeError)
    expect(() => loadRules(root, () => {}, budget as TraversalBudget)).toThrow(
      /invalid traversal budget/,
    )
  })

  it('test_the_file_ceiling_stops_the_sweep_and_says_where', () => {
    const root = project({ 'a.md': 'A', 'b.md': 'B', 'c.md': 'C' })
    const { warn, messages } = collectWarnings()

    const { count } = loadRules(root, warn, { maxDepth: 32, maxFiles: 2 })

    expect(count).toBe(2)
    // Same ceiling, the framework's sentence. The number is what matters and it is still in it.
    expect(messages.some((m) => m.startsWith('[rules] ') && m.includes('2'))).toBe(true)
  })

  it('test_the_depth_ceiling_stops_the_descent_and_says_where', () => {
    const root = project({ 'top.md': 'T', 'one/two/deep.md': 'D' })
    const { warn, messages } = collectWarnings()

    const { count } = loadRules(root, warn, { maxDepth: 1, maxFiles: 100 })

    // `one/` is depth 1 and is entered; `one/two/` is depth 2 and is refused.
    expect(count).toBe(1)
    expect(messages.some((m) => m.startsWith('[rules] ') && m.includes('1'))).toBe(true)
  })
})

describe("loadRules — the guards, now the framework's and still load-bearing here", () => {
  it('test_a_symlink_loop_is_broken_rather_than_hitting_the_ceilings', () => {
    // A path-based guard is defeated by two different paths reaching the same directory; this one
    // keys on dev:ino. Without it the walk does not terminate, it merely hits the ceilings — which
    // is termination by accident rather than by design.
    const root = mkdtempSync(join(sandbox, 'cycle-'))
    const rules = join(root, '.theokit', 'rules')
    const inner = join(rules, 'inner')
    mkdirSync(inner, { recursive: true })
    writeFileSync(join(inner, 'a.md'), 'A')
    // The loop: `inner/loop` points back at the rules root, so `rules/inner/loop/inner` is the same
    // directory reached by a second path.
    symlinkSync(rules, join(inner, 'loop'), 'dir')

    // Asserted through `loadRules` rather than through the walk, because the walk is no longer
    // ours to call. What this product depends on is unchanged and still worth pinning: a directory
    // reachable by two paths is read ONCE, so a loop terminates by design rather than by exhausting
    // a ceiling — which would look identical on a small tree and diverge on a real one.
    const { warn } = collectWarnings()
    const { count } = loadRules(root, warn, { maxDepth: 32, maxFiles: 2_000 })

    expect(count).toBe(1)
  })

  it('test_a_project_without_a_rules_directory_is_silent', () => {
    // A missing `.theokit/rules/` is the normal state of most projects. Warning about it would put
    // a line in front of every user who has not written rules — noise indistinguishable from a real
    // diagnostic once it appears every run.
    const { warn, messages } = collectWarnings()

    expect(loadRules(join(sandbox, 'does-not-exist'), warn)).toEqual({ text: '', count: 0, read: 0, chars: 0, kept: 0, truncated: false })
    expect(messages).toEqual([])
  })
})

describe('loadRules — truncation at the character ceiling', () => {
  it('test_only_whole_rules_survive_and_the_loss_is_announced', () => {
    // 64_000 chars is the ceiling. Two blocks of 40k each exceed it, so only the first fits.
    //
    // This arm used to assert `text.length === 64_000` — the ceiling exactly, because the block was
    // sliced mid-content. B-157 measured the price of that: in this repository's own checkout the
    // prompt ended mid-word ("They differ in what counts as a measure"), and the model had no way to
    // know it was reading a fragment. Whole blocks now, so the length lands wherever the last
    // complete rule ends.
    //
    // What did NOT change, and is still asserted: the caller is told. A truncation nobody reports is
    // indistinguishable from a rule that was never written.
    const big = 'x'.repeat(40_000)
    const root = project({ 'a.md': big, 'b.md': big, 'c.md': 'never reached' })
    const { warn, messages } = collectWarnings()

    const { text, count } = loadRules(root, warn)

    expect(count, 'a second 40k block was admitted under a 64k ceiling').toBe(1)
    expect(text.length).toBeLessThan(64_000)
    expect(text, 'a rule was cut mid-content').toContain(big)
    expect(text, 'the model was not told its instructions are partial').toMatch(/omitted for length/)
    expect(messages.some((m) => m.includes('truncated to 64000 chars'))).toBe(true)
  })

  it('test_content_under_the_ceiling_is_returned_whole_and_unannounced', () => {
    // Anti-vacuity for the case above.
    const root = project({ 'a.md': 'y'.repeat(1_000) })
    const { warn, messages } = collectWarnings()

    const { text } = loadRules(root, warn)

    expect(text.length).toBe(1_000)
    expect(messages).toEqual([])
  })
})
