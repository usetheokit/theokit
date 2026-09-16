/**
 * The style reaches the system prompt, or it is a feature that reads a file and does nothing.
 *
 * The loader and the composition are unit-tested next door; this asserts the WIRING — that
 * `buildChatAgent` resolves `output_style` from the effective config, finds the file, and hands the
 * result to `composeInstructions` as the base. Without this arm every other test in this feature
 * could pass against a product where nothing ever calls them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BASE_INSTRUCTIONS } from '../src/context/index.js'
import { baseInstructionsFor } from '../src/output-style-wiring.js'

let home: string
let project: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-wire-home-'))
  project = mkdtempSync(join(tmpdir(), 'theocode-wire-proj-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

function style(dir: string, file: string, body: string): void {
  mkdirSync(join(dir, '.claude', 'output-styles'), { recursive: true })
  writeFileSync(join(dir, '.claude', 'output-styles', file), body)
}

describe('what the agent is built with', () => {
  it('test_no_configured_style_leaves_the_built_in_instructions_untouched', () => {
    expect(baseInstructionsFor(undefined, { home, project })).toBe(BASE_INSTRUCTIONS)
  })

  it('test_a_configured_style_replaces_them', () => {
    style(project, 'terse.md', '---\ndescription: short\n---\n\nBe terse.\n')

    const base = baseInstructionsFor('terse', { home, project })
    expect(base).toBe('Be terse.')
    expect(base, 'the built-in instructions survived a replacing style').not.toBe(BASE_INSTRUCTIONS)
  })

  it('test_a_configured_style_that_keeps_them_appends', () => {
    style(project, 'plus.md', '---\nkeep-coding-instructions: true\n---\n\nAlso be terse.\n')

    const base = baseInstructionsFor('plus', { home, project })
    expect(base).toContain(BASE_INSTRUCTIONS)
    expect(base).toContain('Also be terse.')
  })

  it('test_a_style_that_does_not_exist_falls_back_rather_than_failing_the_turn', () => {
    // The alternative — refusing to start — punishes a typo in an optional setting by taking the
    // whole product away. Falling back keeps the turn possible; `doctor` is where the name that
    // resolved to nothing is reported.
    expect(baseInstructionsFor('no-such-style', { home, project })).toBe(BASE_INSTRUCTIONS)
  })
})
