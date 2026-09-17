import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, onTestFinished } from 'vitest'

import {
  extractAdrCitations,
  classifyAdrCitation,
  // @ts-expect-error — plain .mjs gate script, typed here rather than shipped with declarations
} from '../../scripts/check-doc-citations.mjs'

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
    const repo = makeRepo(['0001-authorization-is-transport-independent.md'])

    const [cited] = extractAdrCitations('the decorators were removed (ADR-0043)') as Citation[]

    expect(cited?.id, 'the reference was not seen at all').toBe('0043')
    expect(classifyAdrCitation(cited, repo)).toBe('missing_adr')
  })

  it('test_a_reference_that_resolves_passes', () => {
    // The control. A gate that reported every ADR reference would be as useless as one that reported
    // none, and would be turned off just as fast.
    const repo = makeRepo(['0001-authorization-is-transport-independent.md'])

    const [cited] = extractAdrCitations('see ADR-0001') as Citation[]

    expect(classifyAdrCitation(cited, repo)).toBe('ok')
  })

  it('test_it_reads_the_number_and_not_the_filename', () => {
    // `docs/adr/` names files `NNNN-slug.md`, so the id is a prefix rather than the whole name. A
    // check that compared full names would report every real citation as missing.
    const repo = makeRepo(['0002-an-abnormal-ending-is-never-reported-as-normal.md'])

    const [cited] = extractAdrCitations('ADR-0002 says so') as Citation[]

    expect(classifyAdrCitation(cited, repo)).toBe('ok')
  })
})

interface Citation {
  raw: string
  id: string
  docLine: number
}

function makeRepo(adrs: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'adr-cite-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
  for (const name of adrs) writeFileSync(join(root, 'docs', 'adr', name), '# adr\n')
  return root
}
