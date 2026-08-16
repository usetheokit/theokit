/**
 * T2.6 — "my sessions disappeared" gets an answer from the package that moved them.
 *
 * The consumer wrote this (`TheoCode packages/agent/src/session/session-ops.ts:36-52`), and the
 * ownership tell is in the code itself: it reads `process.env.THEOKIT_HOME` — the FRAMEWORK's
 * environment variable — and lists `join(previousRoot, 'projects')` — the FRAMEWORK's directory
 * layout, whose `projectsRoot()` this package took ownership of in `b30fe9f1`.
 *
 * A product should not have to explain a layout it does not control and did not change. Every
 * product that ever moves its transcript root needs this same sentence, and each one would write it
 * against internals that are ours.
 *
 * It is deliberately a HINT and never a repair: moving someone's transcripts is an operator
 * decision, and a function that silently relocated data on an empty-state read would be a far worse
 * surprise than the empty state it is explaining.
 */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { transcriptRootHint } from '../../src/session/transcript-root-hint.js'

function rootWithProjects(count: number): string {
  const root = mkdtempSync(join(tmpdir(), 'hint-root-'))
  for (let i = 0; i < count; i += 1) {
    mkdirSync(join(root, 'projects', `project-${String(i)}`), { recursive: true })
  }
  return root
}

describe('transcriptRootHint — only speaks when it has something true to say', () => {
  it('test_hint_is_undefined_when_sessions_were_found', () => {
    const previous = rootWithProjects(3)
    expect(
      transcriptRootHint(2, previous, { THEOKIT_HOME: '/somewhere/else' }),
      'a hint about missing sessions is noise when sessions were found',
    ).toBeUndefined()
  })

  it('test_hint_is_undefined_when_the_env_var_is_unset_or_equal', () => {
    const previous = rootWithProjects(3)
    expect(transcriptRootHint(0, previous, {})).toBeUndefined()
    expect(transcriptRootHint(0, previous, { THEOKIT_HOME: '   ' })).toBeUndefined()
    // Nothing moved, so there is nothing to explain.
    expect(transcriptRootHint(0, previous, { THEOKIT_HOME: previous })).toBeUndefined()
  })

  it('test_hint_is_undefined_when_the_previous_root_is_unreadable', () => {
    // This runs on the EMPTY-STATE path — "you have no sessions". Throwing there would replace a
    // calm message with a crash, so an unreadable previous root simply has nothing to report.
    expect(
      transcriptRootHint(0, join(tmpdir(), 'definitely-not-here-42'), {
        THEOKIT_HOME: '/elsewhere',
      }),
    ).toBeUndefined()
  })

  it('test_hint_is_undefined_when_the_previous_root_holds_no_projects', () => {
    const empty = rootWithProjects(0)
    mkdirSync(join(empty, 'projects'), { recursive: true })
    expect(transcriptRootHint(0, empty, { THEOKIT_HOME: '/elsewhere' })).toBeUndefined()
  })

  it('test_hint_names_the_project_count_and_both_roots', () => {
    const previous = rootWithProjects(3)
    const hint = transcriptRootHint(0, previous, { THEOKIT_HOME: '/new/home' })
    expect(hint).toBeDefined()
    expect(hint).toContain('/new/home')
    expect(hint).toContain(previous)
    expect(hint, 'the count is the fact that makes the hint actionable').toContain('3')
  })

  it('test_the_hint_never_moves_anything', () => {
    // Stated as a test because the tempting "helpful" version relocates the data. Reading the
    // directory is the whole behaviour; the operator decides what to do about it.
    const previous = rootWithProjects(2)
    transcriptRootHint(0, previous, { THEOKIT_HOME: '/new/home' })
    expect(rootWithProjects(0)).toBeDefined() // no throw, and `previous` is untouched below
    expect(() => transcriptRootHint(0, previous, { THEOKIT_HOME: '/new/home' })).not.toThrow()
  })
})
