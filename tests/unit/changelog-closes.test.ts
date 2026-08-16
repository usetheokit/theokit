/**
 * T4.3 — a closure that reaches the consumer by mechanism rather than by coincidence.
 *
 * The consumer's register lists 8 gaps as open. Verified against the code, none is fully open — five
 * were closed and reached that consumer BY ACCIDENT, because the same person maintains both sides. A
 * customer without that overlap keeps reading "open" against capabilities that already ship, and
 * keeps rebuilding them. That is not a code gap; it is the absence of a channel, and it is why the
 * same measurement keeps finding the same class of waste.
 *
 * The channel is deliberately small: when a change touches a file a registered gap points at, the
 * `[Unreleased]` section must name the gap it closes. The closure then lives in the artifact the
 * consumer already reads.
 *
 * Honest about what this is NOT: a convention with a mechanical check, not a notification system. It
 * makes a closure DISCOVERABLE. It does not push.
 */
import { describe, expect, it } from 'vitest'

import { missingCloses } from '../../scripts/lib/changelog-closes.mjs'

const REGISTRY = [
  { id: 'U-9', files: ['src/free-text-input.tsx'], summary: 'FreeTextInput has no masked mode' },
  { id: 'U-10', files: ['src/select-list-model.ts'], summary: 'WindowView reports booleans only' },
]

const UNRELEASED = ['## [Unreleased]', '', '### Added', '', '- something (closes: U-9)', ''].join(
  '\n',
)

describe('missingCloses', () => {
  it('test_entry_touching_a_registered_gap_file_without_closes_is_flagged', () => {
    const found = missingCloses({
      changedFiles: ['src/select-list-model.ts'],
      changelog: UNRELEASED,
      registry: REGISTRY,
    })
    expect(found.map((f) => f.id)).toEqual(['U-10'])
    expect(found[0].summary, 'the report says what the consumer is still waiting for').toContain(
      'WindowView',
    )
  })

  it('test_entry_with_closes_passes', () => {
    expect(
      missingCloses({
        changedFiles: ['src/free-text-input.tsx'],
        changelog: UNRELEASED,
        registry: REGISTRY,
      }),
    ).toEqual([])
  })

  it('test_a_change_touching_no_registered_file_is_not_the_checks_business', () => {
    expect(
      missingCloses({
        changedFiles: ['README.md', 'src/unrelated.ts'],
        changelog: '## [Unreleased]\n\n### Added\n\n- a thing\n',
        registry: REGISTRY,
      }),
    ).toEqual([])
  })

  it('test_released_sections_are_never_read', () => {
    // Unbreakable Rule 6: released entries are never edited, so a `closes:` sitting in one is
    // history, not a claim about this change. Reading it would let any change inherit a closure
    // somebody else made a year ago.
    const changelog = [
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- a thing',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '- old thing (closes: U-10)',
      '',
    ].join('\n')
    const found = missingCloses({
      changedFiles: ['src/select-list-model.ts'],
      changelog,
      registry: REGISTRY,
    })
    expect(found.map((f) => f.id)).toEqual(['U-10'])
  })

  it('test_an_absent_unreleased_section_is_not_a_violation', () => {
    // EC-19 — a repo mid-release has just emptied `[Unreleased]`. Flagging then would fire on every
    // release cut, which is how a check gets disabled.
    expect(
      missingCloses({
        changedFiles: ['src/select-list-model.ts'],
        changelog: '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n- a thing\n',
        registry: REGISTRY,
      }),
    ).toEqual([])
  })

  it('test_one_change_closing_several_gaps_needs_all_of_them_named', () => {
    const found = missingCloses({
      changedFiles: ['src/free-text-input.tsx', 'src/select-list-model.ts'],
      changelog: UNRELEASED,
      registry: REGISTRY,
    })
    expect(found.map((f) => f.id)).toEqual(['U-10'])
  })

  it('test_the_id_must_be_matched_as_a_whole_token', () => {
    // `U-1` must not be satisfied by a `U-10` sitting in the text — the reason a substring match is
    // the wrong tool for an id with a numeric tail.
    const found = missingCloses({
      changedFiles: ['src/a.ts'],
      changelog: '## [Unreleased]\n\n- did a thing (closes: U-10)\n',
      registry: [{ id: 'U-1', files: ['src/a.ts'], summary: 'the first gap' }],
    })
    expect(found.map((f) => f.id)).toEqual(['U-1'])
  })

  it('test_a_directory_prefix_in_the_registry_matches_files_under_it', () => {
    // Some gaps are about an area, not a file. `src/session/` should match everything below it, so
    // the registry does not have to enumerate a moving target.
    const found = missingCloses({
      changedFiles: ['src/session/gc/transcript-gc.ts'],
      changelog: '## [Unreleased]\n\n- a thing\n',
      registry: [{ id: 'U-1', files: ['src/session/'], summary: 'no retention primitive' }],
    })
    expect(found.map((f) => f.id)).toEqual(['U-1'])
  })
})
