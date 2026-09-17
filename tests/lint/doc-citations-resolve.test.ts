/**
 * The documentation-citation gate detects a rotten `file:line`, and this repository has none
 * (usetheokit/theokit#193).
 *
 * ## The failure this exists to catch
 *
 * A citation into code is the one part of a document that can be checked mechanically, and it was
 * the one part nothing checked. Code that points at the wrong place breaks; a document that points
 * at the wrong place keeps rendering and misleads whoever went to verify it.
 *
 * Two properties are asserted separately, because a gate that only checks existence makes
 * `file.ts:1` the cheapest way to cite without pointing:
 *
 *   1. the path resolves;
 *   2. the line is inside the file.
 *
 * @internal
 */

import { describe, it, expect, onTestFinished } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractCitations,
  classifyCitation,
  isBareName,
  isHistoricalRecord,
  collectDocs,
  extractAdrCitations,
  classifyAdrCitation,
  // @ts-expect-error — plain .mjs gate script, typed here rather than shipped with declarations
} from '../../scripts/check-doc-citations.mjs'

interface Citation {
  raw: string
  path: string
  line: number
  docLine: number
}

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), 'theokit-doc-citations-'))
}

describe('doc citation extraction (theokit#193)', () => {
  it('finds a path citation and records the line it was written on', () => {
    const found = extractCitations(
      'prose\nsee `packages/theo/src/a.ts:42` for detail\n',
    ) as Citation[]
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ path: 'packages/theo/src/a.ts', line: 42, docLine: 2 })
  })

  it('does not read a version number as a citation', () => {
    expect(extractCitations('released in v1.2:30 of the runtime')).toHaveLength(0)
  })

  it('treats a citation with no directory as bare — resolving it would be a guess', () => {
    expect(isBareName('chat.ts')).toBe(true)
    expect(isBareName('agents/chat.ts')).toBe(false)
  })

  it('classifies a changelog as the historical record, whatever directory it sits in', () => {
    expect(isHistoricalRecord('CHANGELOG.md')).toBe(true)
    expect(isHistoricalRecord('packages/theo/CHANGELOG.md')).toBe(true)
    expect(isHistoricalRecord('README.md')).toBe(false)
  })
})

describe('doc citation classification (theokit#193)', () => {
  it('accepts a citation whose file exists and whose line is inside it', () => {
    const root = makeRepo()
    try {
      writeFileSync(join(root, 'a.ts'), 'one\ntwo\nthree\n')
      const c = { raw: 'a.ts:2', path: './a.ts', line: 2, docLine: 1 }
      expect(classifyCitation(c, join(root, 'README.md'), root)).toBe('ok')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a citation whose file no longer exists', () => {
    const root = makeRepo()
    try {
      const c = { raw: 'gone.ts:3', path: 'src/gone.ts', line: 3, docLine: 1 }
      expect(classifyCitation(c, join(root, 'README.md'), root)).toBe('missing_file')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a citation whose line is past the end of a file that does exist', () => {
    const root = makeRepo()
    try {
      writeFileSync(join(root, 'short.ts'), 'one\ntwo\n')
      const c = { raw: 'short.ts:175', path: './short.ts', line: 175, docLine: 1 }
      expect(classifyCitation(c, join(root, 'README.md'), root)).toBe('line_past_eof')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('doc collection (theokit#193)', () => {
  it('collects living documents and skips the changelog and vendored trees', () => {
    const root = makeRepo()
    try {
      writeFileSync(join(root, 'README.md'), '')
      writeFileSync(join(root, 'CHANGELOG.md'), '')
      mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
      writeFileSync(join(root, 'node_modules', 'dep', 'README.md'), '')
      const collected = (collectDocs(root) as string[]).map((p) => p.replace(root + '/', ''))
      expect(collected).toEqual(['README.md'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * #832 — an `ADR-NNNN` reference must resolve to a document, or fail.
 *
 * `README.md` justified the single most consequential API decision in `@theokit/agents` — that agent
 * authoring is builder-only — by citing `ADR-0043`. `docs/adr/` holds four documents and none is
 * 0043: the internal decision trail was deliberately removed from the published tree
 * (`1555f4ff5`), and the citation pointing INTO it was not updated with it.
 *
 * The existing checker resolves `path/to/file.ext:LINE` and looks at nothing else — `grep -c "ADR"`
 * over it returned 0 — so the reference was invisible to the one gate whose job is citations.
 *
 * This is the fabricated-citation class the whole ecosystem's rules are built around, in the document
 * a new consumer reads first. Nothing breaks at runtime; what breaks is the ability to verify a
 * documented decision, which is the entire purpose of citing one.
 */
describe('an ADR citation', () => {
  it('test_a_reference_with_no_document_is_reported', () => {
    const repo = makeAdrRepo(['0001-authorization-is-transport-independent.md'])

    const [cited] = extractAdrCitations('the decorators were removed (ADR-0043)') as Citation[]

    expect(cited?.id, 'the reference was not seen at all').toBe('0043')
    expect(classifyAdrCitation(cited, repo)).toBe('missing_adr')
  })

  it('test_a_reference_that_resolves_passes', () => {
    // The control. A gate that reported every ADR reference would be as useless as one that reported
    // none, and would be turned off just as fast.
    const repo = makeAdrRepo(['0001-authorization-is-transport-independent.md'])

    const [cited] = extractAdrCitations('see ADR-0001') as Citation[]

    expect(classifyAdrCitation(cited, repo)).toBe('ok')
  })

  it('test_it_reads_the_number_and_not_the_filename', () => {
    // `docs/adr/` names files `NNNN-slug.md`, so the id is a prefix rather than the whole name. A
    // check that compared full names would report every real citation as missing.
    const repo = makeAdrRepo(['0002-an-abnormal-ending-is-never-reported-as-normal.md'])

    const [cited] = extractAdrCitations('ADR-0002 says so') as Citation[]

    expect(classifyAdrCitation(cited, repo)).toBe('ok')
  })
})

interface Citation {
  raw: string
  id: string
  docLine: number
}

function makeAdrRepo(adrs: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'adr-cite-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
  for (const name of adrs) writeFileSync(join(root, 'docs', 'adr', name), '# adr\n')
  return root
}
