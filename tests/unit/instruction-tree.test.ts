import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeInstructions } from '../../packages/agents/src/config-entry.js'
import {
  ContextPressureThresholdError,
  contextPressure,
} from '../../packages/agents/src/config-entry.js'
import { loadInstructionTree } from '../../packages/agents/src/config-entry.js'

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
