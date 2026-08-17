import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeInstructions } from '../../packages/agents/src/config-entry.js'
import {
  ContextPressureThresholdError,
  contextPressure,
} from '../../packages/agents/src/config-entry.js'
import {
  expandInstructionImports,
  loadInstructionTree,
} from '../../packages/agents/src/config-entry.js'

/**
 * M74 — the instruction tree, the composition ladder, and context pressure.
 *
 * Real files rather than mocks throughout the loader: the properties under test are containment,
 * inode identity and budget ceilings, and every one of them is about what the filesystem actually
 * does. A mocked fs would let the symlink test pass while the loader happily followed the link.
 */

let root: string
const warnings: string[] = []
const onWarn = (message: string): void => {
  warnings.push(message)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theokit-instr-'))
  warnings.length = 0
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const write = (rel: string, body: string): string => {
  const path = join(root, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body, 'utf8')
  return path
}

const budget = { maxDepth: 5, maxFiles: 50, maxChars: 100_000 }

describe('loadInstructionTree — walking and loading', () => {
  it('test_it_loads_the_conventional_file_names', () => {
    write('THEO.md', 'root rules')
    write('nested/AGENTS.md', 'nested rules')
    const tree = loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn })
    expect(tree.blocks.map((b) => b.content)).toEqual(['root rules', 'nested rules'])
    expect(tree.count).toBe(2)
    expect(tree.truncated).toBe(false)
  })

  it('test_a_rules_directory_is_collected_by_predicate_not_by_name', () => {
    // A rules FOLDER is the shape an exact-name list cannot express.
    //
    // `fileNames.includes(entry)` matches a basename, so the walk could only ever collect files the
    // caller could name in advance. A rules directory is the opposite: the user drops arbitrarily
    // named files in and expects all of them read. That is not a TheoCode idiosyncrasy — Claude Code
    // reads (this repository has 34 such files, named `cycle-*.md`, `git-safety.md`,
    // `testing.md`…) and Cursor reads `.cursor/rules/*.mdc`. Both are arbitrary-name directories.
    //
    // Measured consequence of the gap: the closest consumer wrote its own 112-line walk — budget,
    // depth ceiling, cycle guard and all — because ours could not be asked this question.
    write('.theokit/rules/git-safety.md', 'never force-push')
    write('.theokit/rules/testing.md', 'red before green')
    write('.theokit/rules/nested/architecture.md', 'depend inward')
    write('.theokit/rules/notes.txt', 'not markdown')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.theokit/rules'],
      budget,
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
    })

    expect(tree.blocks.map((b) => b.content).sort((a, b) => a.localeCompare(b))).toEqual([
      'depend inward',
      'never force-push',
      'red before green',
    ])
    // The predicate is a filter, not an invitation to read everything.
    expect(tree.blocks.map((b) => b.content)).not.toContain('not markdown')
  })

  it('test_a_declared_but_unreadable_paths_scope_is_flagged_not_silently_widened', () => {
    // The widening this flag exists to stop.
    //
    // `parsePathsScope` reads lines and never fails, so a `paths:` whose value it cannot extract
    // yields `[]` — which is the SAME value as a file that declared no scope at all. A consumer that
    // renders `scopes` then turns a rule meant for one subtree into a rule that applies everywhere,
    // and nothing anywhere says so. Widening a scope silently is the one frontmatter failure with a
    // consequence: the model obeys a rule outside the files it was written for.
    //
    // `[]` and "declared but unreadable" must be distinguishable, so a product with a fail-closed
    // policy can drop the block instead of publishing it unscoped.
    write('scoped.md', '---\npaths:\n---\nbody')
    write('unscoped.md', 'plain body')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget,
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
    })

    const scoped = tree.blocks.find((b) => b.path === 'scoped.md')
    const unscoped = tree.blocks.find((b) => b.path === 'unscoped.md')

    expect(scoped?.scopes).toEqual([])
    expect(scoped?.scopesUnreadable, 'a declared-but-empty paths must be distinguishable').toBe(
      true,
    )
    // A file that never declared a scope is NOT flagged — otherwise the signal means nothing.
    expect(unscoped?.scopesUnreadable).toBe(false)
    expect(warnings.some((w) => w.includes('scoped.md'))).toBe(true)
  })

  it('test_a_rules_folder_can_ask_for_lexicographic_order', () => {
    // Half a capability is its own kind of defect.
    //
    // The predicate made a rules FOLDER walkable; the ordering stayed the one an instruction TREE
    // needs — files at each level before descending, because there the outer file states the rule
    // and the inner refines it. A rules folder means the opposite: the files are peers, and the
    // contract users depend on is that the same tree assembles the same prompt on any machine, in
    // one alphabetical pass. Walking a rules folder in tree order is not what a rules folder means.
    //
    // Both orders are deterministic. Only one is right per shape, and only the caller knows which.
    write('rules/deep/architecture.md', 'inner')
    write('rules/top.md', 'outer')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['rules'],
      budget,
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
      order: 'lexicographic',
    })

    // `deep/` sorts before `top.md`, and a single pass descends when it reaches it.
    expect(tree.blocks.map((b) => b.content)).toEqual(['inner', 'outer'])
  })

  it('test_the_tree_order_is_still_the_default', () => {
    // Additive: an instruction tree that never asks keeps files-before-subdirectories, which is the
    // order its composer needs. A default that changed under existing callers would be the same
    // silent contract shift this option exists to let a caller opt into deliberately.
    write('THEO.md', 'outer')
    write('nested/AGENTS.md', 'inner')

    const tree = loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn })

    expect(tree.blocks.map((b) => b.content)).toEqual(['outer', 'inner'])
  })

  it('test_an_unterminated_inline_paths_list_reads_as_unreadable_not_as_a_scope', () => {
    // `paths: [unclosed` produced the scope `unclose`.
    //
    // The inline branch did `inline.slice(1, inline.lastIndexOf(']'))`, and `lastIndexOf` returns
    // -1 when the bracket never arrives — so `slice(1, -1)` quietly dropped the last character and
    // handed back a scope that was never written. Worse than an empty list, because
    // `scopesUnreadable` stayed false: the block looked correctly scoped, to a path matching
    // nothing, so the rule silently stopped applying anywhere and nothing said so.
    write('bad.md', '---\npaths: [unclosed\n---\nbody')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget,
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
    })

    const block = tree.blocks.find((b) => b.path === 'bad.md')
    expect(block?.scopes).toEqual([])
    expect(block?.scopesUnreadable, 'a truncated inline list is not a scope').toBe(true)
  })

  it('test_a_terminated_inline_paths_list_still_parses', () => {
    // Anti-vacuity: refusing the unterminated one must not refuse the ordinary one.
    write('good.md', '---\npaths: [src/**, tests/**]\n---\nbody')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget,
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
    })

    expect(tree.blocks.find((b) => b.path === 'good.md')?.scopes).toEqual(['src/**', 'tests/**'])
  })

  it('test_the_depth_ceiling_says_where_it_stopped', () => {
    // The file ceiling announced itself (`instruction budget: stopped at N files`); the depth
    // ceiling was a bare `return false`. A budget that stops silently is indistinguishable from a
    // directory that had nothing left in it — the reader concludes their file is missing and goes
    // looking for a typo in the filename.
    //
    // Two ceilings on the same walk, one of them audible, is the asymmetry: whichever one fires,
    // the answer to "why is my instruction file not being read?" has to be in the output.
    write('top.md', 'shallow')
    write('one/two/deep.md', 'too deep')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget: { maxDepth: 1, maxFiles: 50, maxChars: 100_000 },
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
    })

    expect(tree.blocks.map((b) => b.content)).toEqual(['shallow'])
    expect(warnings.some((w) => w.includes('depth') && w.includes('1'))).toBe(true)
  })

  it('test_an_exact_name_list_keeps_working_unchanged', () => {
    // The widening is additive. Every existing caller passes an array, and this pins that the array
    // branch is not quietly routed through the predicate with different semantics.
    write('THEO.md', 'kept')
    write('other.md', 'skipped')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget,
      onWarn,
      fileNames: ['THEO.md'],
    })

    expect(tree.blocks.map((b) => b.content)).toEqual(['kept'])
  })

  it('test_it_ignores_files_it_was_not_asked_for', () => {
    // Anti-vacuity: without this, a loader that read every file would pass the test above.
    write('THEO.md', 'wanted')
    write('README.md', 'not wanted')
    expect(loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn }).count).toBe(1)
  })

  it('test_an_absent_root_is_not_an_error', () => {
    // The common case on a fresh project. Throwing would make "no instructions yet" a failure.
    expect(loadInstructionTree({ cwd: root, roots: ['nope'], budget, onWarn }).count).toBe(0)
  })
})

describe('containment — the prompt-injection vector', () => {
  it('test_a_symlink_pointing_OUTSIDE_the_project_is_refused_and_warned', () => {
    // The security control. A symlink inside a cloned repository can point at `~/.ssh/config`, and
    // following it injects that file into the model's system prompt. Every consumer that writes
    // this loader by hand reintroduces the hole.
    const outside = mkdtempSync(join(tmpdir(), 'theokit-outside-'))
    try {
      writeFileSync(join(outside, 'secret.md'), 'SECRET', 'utf8')
      mkdirSync(join(root, 'evil'), { recursive: true })
      symlinkSync(join(outside, 'secret.md'), join(root, 'evil', 'THEO.md'))

      const tree = loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn })
      expect(tree.blocks.map((b) => b.content).join('')).not.toContain('SECRET')
      expect(warnings.join('\n')).toMatch(/escapes the project root/i)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('test_a_symlink_INSIDE_the_project_is_still_followed', () => {
    // Counter-proof. A guard that refused every link would break the legitimate case — a shared
    // instruction file linked from two subprojects — and a guard that refuses everything teaches
    // people to turn it off.
    write('shared/THEO.md', 'shared rules')
    mkdirSync(join(root, 'app'), { recursive: true })
    symlinkSync(join(root, 'shared', 'THEO.md'), join(root, 'app', 'THEO.md'))
    const tree = loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn })
    expect(tree.blocks.map((b) => b.content)).toContain('shared rules')
  })

  it('test_a_symlink_CYCLE_terminates', () => {
    // Broken by inode, not by path: a loop produces infinitely many distinct paths for the same
    // directory, so a path-keyed `seen` set never terminates.
    mkdirSync(join(root, 'a'), { recursive: true })
    symlinkSync(join(root, 'a'), join(root, 'a', 'loop'))
    write('a/THEO.md', 'once')
    const tree = loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn })
    expect(tree.blocks.filter((b) => b.content === 'once')).toHaveLength(1)
  })
})

describe('frontmatter — per-file failure, never per-tree', () => {
  it('test_it_parses_a_paths_scope_and_strips_the_frontmatter', () => {
    write('THEO.md', '---\npaths:\n  - src/**\n  - tests/**\n---\nbody text')
    const [block] = loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn }).blocks
    expect(block.scopes).toEqual(['src/**', 'tests/**'])
    expect(block.content.trim()).toBe('body text')
  })

  it('test_an_inline_array_scope_parses_too', () => {
    write('THEO.md', '---\npaths: ["a/**", "b/**"]\n---\nbody')
    expect(
      loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn }).blocks[0].scopes,
    ).toEqual(['a/**', 'b/**'])
  })

  it('test_an_UNCLOSED_frontmatter_skips_that_file_and_keeps_the_rest', () => {
    // The whole point of per-file failure: one malformed file must not silently disable every
    // instruction the user wrote. That would be the loudest failure producing the quietest outcome.
    write('bad/THEO.md', '---\npaths:\n  - x\nno closing fence, body follows')
    write('good/THEO.md', 'good rules')
    const tree = loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn })
    expect(tree.blocks.map((b) => b.content)).toEqual(['good rules'])
    expect(warnings.join('\n')).toMatch(/frontmatter never closes/i)
  })

  it('test_a_file_with_no_frontmatter_is_loaded_whole', () => {
    write('THEO.md', 'plain body')
    const [block] = loadInstructionTree({ cwd: root, roots: ['.'], budget, onWarn }).blocks
    expect(block.content).toBe('plain body')
    expect(block.scopes).toEqual([])
  })
})

describe('budgets — explicit ceilings, and a caller who knows it was cut', () => {
  it('test_maxFiles_stops_the_walk_and_reports_truncated', () => {
    for (const n of [1, 2, 3]) write(`d${String(n)}/THEO.md`, `file ${String(n)}`)
    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget: { ...budget, maxFiles: 2 },
      onWarn,
    })
    expect(tree.count).toBe(2)
    expect(tree.truncated).toBe(true)
    expect(warnings.join('\n')).toMatch(/2 files/)
  })

  it('test_maxChars_stops_the_walk_and_reports_truncated', () => {
    write('a/THEO.md', 'x'.repeat(60))
    write('b/THEO.md', 'y'.repeat(60))
    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget: { ...budget, maxChars: 100 },
      onWarn,
    })
    expect(tree.truncated).toBe(true)
    expect(warnings.join('\n')).toMatch(/characters/)
  })

  it('test_maxDepth_bounds_the_descent', () => {
    write('THEO.md', 'top')
    write('a/b/c/THEO.md', 'deep')
    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget: { ...budget, maxDepth: 1 },
      onWarn,
    })
    expect(tree.blocks.map((b) => b.content)).toEqual(['top'])
  })
})

describe('composeInstructions — the ladder cuts, the caller ordered', () => {
  const sources = [
    { name: 'most-important', content: 'A'.repeat(30) },
    { name: 'middle', content: 'B'.repeat(30) },
    { name: 'least-important', content: 'C'.repeat(30) },
  ]

  it('test_everything_fits_when_there_is_room', () => {
    const result = composeInstructions('base', sources, { maxChars: 10_000, onWarn })
    expect(result.dropped).toEqual([])
    expect(result.text).toContain('A'.repeat(30))
    expect(result.text).toContain('C'.repeat(30))
  })

  it('test_it_cuts_from_the_END_of_the_list_the_caller_ordered', () => {
    // The milestone's named risk, asserted: the framework supplies the cutting MECHANISM and the
    // product supplies the ORDER. The last entry is the one the caller said matters least.
    const result = composeInstructions('base', sources, { maxChars: 45, onWarn })
    expect(result.dropped).toContain('least-important')
    expect(result.text).toContain('A'.repeat(30))
  })

  it('test_no_source_NAME_is_special_to_the_framework', () => {
    // Counter-proof for the same risk: rename everything and the behaviour is identical.
    const renamed = sources.map((s, i) => ({ ...s, name: `zzz-${String(i)}` }))
    const result = composeInstructions('base', renamed, { maxChars: 45, onWarn })
    expect(result.dropped).toEqual(['zzz-2'])
  })

  it('test_it_TRIMS_the_last_survivor_rather_than_dropping_it_whole', () => {
    // Half of what the user wrote beats none of it. Only one source is ever cut — trimming several
    // would leave a prompt where nothing is complete.
    const result = composeInstructions('base', [sources[0]], { maxChars: 20, onWarn })
    expect(result.trimmed).toBe('most-important')
    expect(result.text.length).toBeLessThanOrEqual(20)
  })

  it('test_the_BASE_is_never_dropped', () => {
    // It is the agent's identity. An agent without it is a different agent, and returning an empty
    // string would be a silent lobotomy.
    const result = composeInstructions('IDENTITY', sources, { maxChars: 5, onWarn })
    expect(result.text).toContain('IDENT')
    expect(result.dropped).toHaveLength(3)
  })

  it('test_every_cut_is_WARNED', () => {
    // Silence here loses the user's instructions without telling them.
    composeInstructions('base', sources, { maxChars: 45, onWarn })
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('contextPressure — the numerator finally meets the denominator', () => {
  it.each([
    [0, 1000, 'ok'],
    [500, 1000, 'ok'],
    [750, 1000, 'warn'],
    [899, 1000, 'warn'],
    [900, 1000, 'critical'],
    [5000, 1000, 'critical'],
  ])('test_%i_of_%i_is_%s', (used, window, expected) => {
    expect(contextPressure(used, window)).toBe(expected)
  })

  it('test_an_UNKNOWN_window_reports_ok_rather_than_dividing', () => {
    // Missing evidence is not evidence — the same rule the transcript collector applies to a
    // missing mtime. `Infinity` or `NaN` reaching a UI as a percentage is worse than saying nothing.
    expect(contextPressure(500, 0)).toBe('ok')
    expect(contextPressure(500, Number.NaN)).toBe('ok')
  })

  it('test_thresholds_are_configurable', () => {
    // A product with long tool outputs legitimately wants an earlier warning than one with short
    // chat turns.
    expect(contextPressure(500, 1000, { warn: 0.4, critical: 0.95 })).toBe('warn')
  })

  it('test_INVERTED_thresholds_are_refused', () => {
    // A caller who inverted them holds a belief about their own thresholds that is wrong, and
    // silently sorting them would leave that belief intact until it surprises someone.
    expect(() => contextPressure(500, 1000, { warn: 0.9, critical: 0.5 })).toThrow(
      ContextPressureThresholdError,
    )
  })
})

/**
 * `@file.md` imports — the half of the loader a measured consumer had to write itself.
 *
 * `loadInstructionTree` walked directories and loaded whole files, and stopped there. The closest
 * real consumer needs one more thing from an instruction file: the ability to say `@./style.md` and
 * have that file's content land in the prompt. Without it, migrating to this loader would have been
 * a REGRESSION, not an absorption — which is why the capability lands here before the migration
 * rather than after.
 *
 * Three properties carry it, and each has a way of being wrong that is invisible:
 *
 *  1. **A reference inside code is not an import.** `@foo.md` inside a fence or backticks is prose
 *     ABOUT an import. Expanding it rewrites the user's documentation.
 *  2. **Containment, on the real path.** An import that resolves outside the root is kept literal,
 *     never read — the same boundary the walk already enforces, applied to a second entry point.
 *  3. **Depth and cycles are bounded.** `a → b → a` must terminate, and a chain must stop.
 */
describe('loadInstructionTree — @file.md imports', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'theokit-imports-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const load = (onWarn?: (m: string) => void) =>
    loadInstructionTree({
      cwd: root,
      roots: [root],
      budget: { maxFiles: 20, maxChars: 64_000, maxDepth: 5 },
      ...(onWarn === undefined ? {} : { onWarn }),
    })

  it('expands_a_relative_import', () => {
    writeFileSync(join(root, 'AGENTS.md'), 'top\n\n@./style.md\n', 'utf8')
    writeFileSync(join(root, 'style.md'), 'two spaces, never tabs', 'utf8')

    const text = load()
      .blocks.map((b) => b.content)
      .join('\n')

    expect(text).toContain('two spaces, never tabs')
    expect(text, 'the reference survived unexpanded').not.toContain('@./style.md')
  })

  it('a_reference_inside_a_fence_is_not_an_import', () => {
    // Prose ABOUT the syntax, not a use of it. Expanding it rewrites the user's own documentation —
    // and the user only finds out by reading a prompt that no longer says what they wrote.
    writeFileSync(
      join(root, 'AGENTS.md'),
      'howto\n\n```\n@./style.md\n```\n\nand inline `@./style.md` too\n',
      'utf8',
    )
    writeFileSync(join(root, 'style.md'), 'SHOULD-NOT-APPEAR', 'utf8')

    const text = load()
      .blocks.map((b) => b.content)
      .join('\n')

    expect(text, 'a fenced reference was expanded').not.toContain('SHOULD-NOT-APPEAR')
    expect(text).toContain('@./style.md')
  })

  it('an_import_outside_the_root_is_kept_literal_and_warned', () => {
    const outside = mkdtempSync(join(tmpdir(), 'theokit-outside-'))
    writeFileSync(join(outside, 'secret.md'), 'SHOULD-NOT-APPEAR', 'utf8')
    writeFileSync(
      join(root, 'AGENTS.md'),
      `see @../${join(outside).split('/').pop()}/secret.md\n`,
      'utf8',
    )

    const warnings: string[] = []
    const text = load((m) => warnings.push(m))
      .blocks.map((b) => b.content)
      .join('\n')

    expect(text, 'an import escaped the root').not.toContain('SHOULD-NOT-APPEAR')
    expect(warnings.join('\n'), 'the refusal was silent').toMatch(/outside|not found/i)
    rmSync(outside, { recursive: true, force: true })
  })

  it('a_missing_import_is_kept_literal_and_warned', () => {
    writeFileSync(join(root, 'AGENTS.md'), 'see @./nope.md\n', 'utf8')

    const warnings: string[] = []
    const text = load((m) => warnings.push(m))
      .blocks.map((b) => b.content)
      .join('\n')

    expect(text).toContain('@./nope.md')
    expect(warnings.join('\n')).toMatch(/not found/i)
  })

  it('a_cycle_expands_each_file_once', () => {
    // `a → b → a`, and the assertion is on the COUNT, not on termination.
    //
    // The first version of this case asserted only that A and B appear — and a tamper-test showed it
    // stayed green with the visited set deleted, because the depth cap terminates the cycle anyway.
    // It was exercising the cap under the name of the guard. What the visited set actually buys is
    // that a file is expanded ONCE per branch: without it, the cycle unrolls to the cap and the same
    // paragraph lands in the prompt four times over.
    writeFileSync(join(root, 'AGENTS.md'), 'root\n\n@./a.md\n', 'utf8')
    writeFileSync(join(root, 'a.md'), 'ALPHA\n\n@./b.md\n', 'utf8')
    writeFileSync(join(root, 'b.md'), 'BETA\n\n@./a.md\n', 'utf8')

    const text = load()
      .blocks.map((b) => b.content)
      .join('\n')

    expect(text.match(/ALPHA/g) ?? [], 'a file was expanded more than once').toHaveLength(1)
    expect(text.match(/BETA/g) ?? []).toHaveLength(1)
  })

  it('depth_is_bounded_and_the_cap_is_announced', () => {
    writeFileSync(join(root, 'AGENTS.md'), '@./d1.md\n', 'utf8')
    for (let i = 1; i <= 8; i++) {
      writeFileSync(
        join(root, `d${String(i)}.md`),
        `L${String(i)}\n\n@./d${String(i + 1)}.md\n`,
        'utf8',
      )
    }

    const warnings: string[] = []
    const text = load((m) => warnings.push(m))
      .blocks.map((b) => b.content)
      .join('\n')

    expect(text).toContain('L1')
    expect(warnings.join('\n'), 'the depth cap was silent').toMatch(/depth/i)
  })

  it('a_file_with_no_imports_is_unchanged', () => {
    // Backward-compatibility guard: expansion is invisible to every existing caller.
    writeFileSync(join(root, 'AGENTS.md'), 'plain content, no refs\n', 'utf8')

    expect(load().blocks[0]?.content).toContain('plain content, no refs')
  })
})

/**
 * The expansion is reachable WITHOUT the walk.
 *
 * The walk and the expansion are separate capabilities, and only one of them is universal. A product
 * whose convention is the ancestor chain — climb from the working directory to the git root — needs
 * its own walk and the same expansion. Shipping the expansion fused to the descent is why the
 * measured consumer kept a hand-written copy of it.
 */
describe('expandInstructionImports — usable on its own', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theokit-expand-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('expands_without_any_directory_walk', () => {
    const file = join(dir, 'AGENTS.md')
    writeFileSync(file, 'top\n\n@./style.md\n', 'utf8')
    writeFileSync(join(dir, 'style.md'), 'two spaces', 'utf8')

    const out = expandInstructionImports({
      text: 'top\n\n@./style.md\n',
      filePath: file,
      rootDir: dir,
      onWarn: () => undefined,
    })

    expect(out).toContain('two spaces')
  })

  it('keeps_the_same_containment_when_called_directly', () => {
    // The boundary is not a property of the walk — a caller reaching the expansion directly gets it
    // too, or the seam would be a way around the check.
    const outside = mkdtempSync(join(tmpdir(), 'theokit-expand-out-'))
    writeFileSync(join(outside, 'secret.md'), 'SHOULD-NOT-APPEAR', 'utf8')
    const file = join(dir, 'AGENTS.md')
    const ref = `@${join(outside, 'secret.md')}`

    const warnings: string[] = []
    const out = expandInstructionImports({
      text: `see ${ref}\n`,
      filePath: file,
      rootDir: dir,
      onWarn: (m) => warnings.push(m),
    })

    expect(out).not.toContain('SHOULD-NOT-APPEAR')
    expect(warnings.join('\n')).toMatch(/outside|not found/i)
    rmSync(outside, { recursive: true, force: true })
  })
})

/**
 * Two seams the measured consumer needs to stop maintaining its own copy.
 *
 * Neither is a knob invented for a hypothetical caller — both are the difference between "we ship
 * the capability" and "they can actually use it", found by trying the swap:
 *
 *  - **`wrap`** — its expansion surrounds imported content with `--- import: x ---` markers, which
 *    are visible in the model's prompt. Ours had no say in presentation, so a straight swap would
 *    have silently changed what the product sends. Presentation is the caller's.
 *  - **`alreadyLoaded`** — its walk collects the ancestor chain first, then expands, seeding the
 *    visited set with everything the walk already read. Without that seam, a file loaded by the walk
 *    AND referenced by an import lands in the prompt twice.
 */
describe('expandInstructionImports — the caller owns presentation and prior reads', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theokit-expand-seams-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('wrap_lets_the_caller_frame_imported_content', () => {
    const file = join(dir, 'AGENTS.md')
    writeFileSync(join(dir, 'style.md'), 'BODY', 'utf8')

    const out = expandInstructionImports({
      text: '@./style.md',
      filePath: file,
      rootDir: dir,
      onWarn: () => undefined,
      wrap: (name, content) => `<<${name}|${content}>>`,
    })

    expect(out).toBe('<<./style.md|BODY>>')
  })

  it('without_wrap_the_content_is_inlined_bare', () => {
    // Backward-compatibility guard: every existing caller sees exactly what it saw before the seam.
    const file = join(dir, 'AGENTS.md')
    writeFileSync(join(dir, 'style.md'), 'BODY', 'utf8')

    expect(
      expandInstructionImports({
        text: '@./style.md',
        filePath: file,
        rootDir: dir,
        onWarn: () => undefined,
      }),
    ).toBe('BODY')
  })

  it('alreadyLoaded_prevents_a_second_copy_of_a_file_the_caller_read', () => {
    const file = join(dir, 'AGENTS.md')
    const style = join(dir, 'style.md')
    writeFileSync(style, 'SEEN-ONCE', 'utf8')

    const out = expandInstructionImports({
      text: '@./style.md',
      filePath: file,
      rootDir: dir,
      onWarn: () => undefined,
      alreadyLoaded: [style],
    })

    expect(out, 'a file the caller already read was inlined again').toBe('@./style.md')
  })
})

describe('frontmatter — CRLF is not a broken file', () => {
  it('test_a_crlf_file_with_valid_frontmatter_is_read_not_skipped', () => {
    // `splitFrontmatter` split on '\n' and compared each line to '---'. On CRLF the closing line is
    // '---\r', which never equals the fence, so `indexOf` failed and the function returned
    // `undefined` — the value that means "frontmatter never closes".
    //
    // The consequence is silent and total: on a Windows checkout every instruction file WITH
    // frontmatter is skipped, and the warning blames a missing `---` that is sitting right there.
    // The user hunts for a syntax error that does not exist while their rules quietly do not apply.
    //
    // The opening line was already tolerant (`lines[0]?.trim()`); only the closing comparison was
    // not — so a file could open its frontmatter successfully and never be allowed to close it.
    write('crlf.md', '---\r\npaths:\r\n  - src/**\r\n---\r\nbody in CRLF')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget,
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
    })

    const block = tree.blocks.find((b) => b.path === 'crlf.md')
    expect(block, 'a valid CRLF file was skipped as if its frontmatter never closed').toBeDefined()
    expect(block?.content.trim()).toBe('body in CRLF')
    expect(block?.scopes).toEqual(['src/**'])
    expect(warnings.some((w) => w.includes('never closes'))).toBe(false)
  })

  it('test_a_closing_fence_with_trailing_space_still_closes', () => {
    // The same asymmetry, from the other direction, and the reason the closing comparison trims.
    //
    // The OPENING check was already `lines[0]?.trim() === FENCE`, so `'--- '` opens a frontmatter
    // block. The closing check was an exact match, so `'--- '` could never close the block it was
    // allowed to open. Normalising line endings does not reach this case — the character is a
    // space, not a carriage return — so without the trim the file is skipped as never-closing.
    write('spaced.md', '---\npaths:\n  - src/**\n--- \nbody')

    const tree = loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget,
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
    })

    const block = tree.blocks.find((b) => b.path === 'spaced.md')
    expect(block?.content.trim()).toBe('body')
    expect(block?.scopes).toEqual(['src/**'])
  })

  it('test_an_actually_unclosed_frontmatter_is_still_refused', () => {
    // Anti-vacuity: tolerating '\r' must not tolerate a fence that never arrives.
    write('open.md', '---\r\npaths:\r\n  - src/**\r\nbody with no closing fence')

    loadInstructionTree({
      cwd: root,
      roots: ['.'],
      budget,
      onWarn,
      fileNames: (entry) => entry.endsWith('.md'),
    })

    expect(warnings.some((w) => w.includes('never closes'))).toBe(true)
  })
})
