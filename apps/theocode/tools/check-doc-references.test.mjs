/**
 * Tests for the dangling-reference guard.
 *
 * B-151 — the guard exists because B-134 was a README citation to a file that did not exist, was not
 * tracked, and was not ignored, offered as the record of a decision. It was fixed by hand and
 * nothing stopped the next one — and the next one arrived within the hour, in the section written to
 * fix a sibling finding.
 *
 * Two of these are anti-vacuity floors. Without them a guard that flags everything and a guard that
 * flags nothing would both pass, which is how the English-only guard reported clean over 144
 * identifiers.
 */
import { describe, expect, it } from 'vitest'

import {
  citedPaths,
  citedSubpaths,
  danglingReferences,
  danglingSubpaths,
} from './check-doc-references.mjs'

describe('citedPaths', () => {
  it('test_it_finds_a_backticked_repository_path', () => {
    expect(citedPaths('see `docs/adr/0002-thing.md` for why')).toEqual(['docs/adr/0002-thing.md'])
  })

  it('test_it_ignores_prose_and_urls', () => {
    // Anti-vacuity: a matcher that returned everything would satisfy the test above.
    expect(citedPaths('read https://example.com/a.md and `npm test` and `--apply`')).toEqual([])
  })

  it('test_it_does_not_repeat_a_path_cited_twice', () => {
    expect(citedPaths('`a/b.ts` and again `a/b.ts`')).toEqual(['a/b.ts'])
  })
})

describe('danglingReferences', () => {
  const never = () => false
  const always = () => true

  it('test_a_path_that_does_not_exist_and_is_not_ignored_is_dangling', () => {
    // The finding, as an assertion: this is exactly B-134's shape.
    expect(danglingReferences(['docs/adr/0002.md'], { exists: never, ignored: never })).toEqual([
      'docs/adr/0002.md',
    ])
  })

  it('test_a_path_that_exists_is_not_dangling', () => {
    expect(danglingReferences(['README.md'], { exists: always, ignored: never })).toEqual([])
  })

  it('test_a_deliberately_ignored_path_is_dangling_too', () => {
    // REVERSED 2026-09-03, and the reversal is the finding. This assertion used to expect `[]`, on
    // the reasoning that "`.claude/` is local by design, so citing it is a choice about what the
    // reader can see". The repository's own practice contradicted that twice in one session: B-134
    // was a citation to `rules/public-copy.md` and B-151 found the same file cited again, and BOTH
    // were fixed by deleting the citation and inlining the reasoning — because a reader who clones
    // cannot open it. A guard whose test says one thing while every fix says the other is protecting
    // the wrong behaviour.
    expect(
      danglingReferences(['.claude/rules/public-copy.md'], { exists: never, ignored: always }),
    ).toEqual(['.claude/rules/public-copy.md'])
  })

  it('test_a_path_the_README_describes_rather_than_cites_is_exempt', () => {
    // `AGENTS.md` is the file an operator may put in THEIR project. The gate cannot tell description
    // from citation, so the exemption is explicit and carries its reason in the source.
    expect(danglingReferences(['AGENTS.md'], { exists: never, ignored: never })).toEqual([])
  })

  it('test_the_exemption_list_does_not_swallow_everything', () => {
    // Anti-vacuity floor on the escape hatch itself: an allowlist that grew to match any path would
    // turn the guard off while leaving it green.
    expect(
      danglingReferences(['AGENTS.md', 'docs/invented.md'], { exists: never, ignored: never }),
    ).toEqual(['docs/invented.md'])
  })
})

describe('the two holes measured 2026-09-03', () => {
  // Hole 1 — the extension list covered only what THIS repository writes, so a citation into a
  // foreign project sailed through. Found by citing a Rust path in the README while fixing a
  // different citation defect, in the same session that built this guard.
  it('test_a_path_into_a_foreign_language_is_still_a_citation', () => {
    expect(citedPaths('read `codex-rs/tui/src/slash_command.rs` for the enum')).toEqual([
      'codex-rs/tui/src/slash_command.rs',
    ])
  })

  // Hole 2 — `ignored` was an ESCAPE, and a gitignored path is the one case guaranteed unopenable
  // for everyone who clones. That is precisely the B-134 defect this guard exists to catch, admitted
  // through the back door.
  it('test_a_gitignored_path_is_dangling_even_when_it_exists_here', () => {
    expect(
      danglingReferences(['.claude/rules/public-copy.md'], {
        exists: () => true,
        ignored: () => true,
      }),
    ).toEqual(['.claude/rules/public-copy.md'])
  })

  it('test_a_tracked_file_that_exists_is_still_fine', () => {
    // Anti-vacuity: flagging everything would satisfy both assertions above.
    expect(danglingReferences(['README.md'], { exists: () => true, ignored: () => false })).toEqual([])
  })
})

describe('citedSubpaths', () => {
  it('test_it_finds_a_backticked_workspace_package_subpath', () => {
    // The finding, as an assertion. `@theocode/shared/shutdown` is advertised by README.md:40 and
    // resolves to nothing: the module was deleted in favour of the framework's and the row that
    // advertises it never moved. A contributor who follows the README gets an unresolved specifier.
    expect(citedSubpaths('reached as `@theocode/shared/shutdown`, `/agent`')).toEqual([
      ['@theocode/shared', './shutdown'],
    ])
  })

  it('test_it_ignores_a_bare_package_name_and_a_foreign_scope', () => {
    // Anti-vacuity twice over. A matcher returning everything passes the case above; one that
    // resolved foreign scopes would report every `@theokit/agents/persistence` in the docs as
    // dangling, because those packages are not in this workspace and their exports are not ours
    // to check.
    expect(citedSubpaths('`@theocode/tui` and `@theokit/agents/persistence` and `npm test`')).toEqual(
      [],
    )
  })
})

describe('danglingSubpaths', () => {
  const exportsOf = (pkg) =>
    pkg === '@theocode/shared' ? { './agent': 'x', './diagnostic-sink': 'x' } : undefined

  it('test_a_subpath_absent_from_the_exports_map_is_dangling', () => {
    expect(danglingSubpaths([['@theocode/shared', './shutdown']], { exportsOf })).toEqual([
      '@theocode/shared/shutdown',
    ])
  })

  it('test_a_declared_subpath_is_not_dangling', () => {
    // Anti-vacuity: a checker that flagged every subpath would satisfy the case above.
    expect(danglingSubpaths([['@theocode/shared', './agent']], { exportsOf })).toEqual([])
  })

  it('test_a_package_with_no_manifest_is_not_reported', () => {
    // Absence of a manifest is not evidence of a missing export — it means this is not a workspace
    // package, and asserting anything about its surface would be a claim nobody measured.
    expect(danglingSubpaths([['@theocode/ghost', './thing']], { exportsOf })).toEqual([])
  })
})
