// The header must name the file the instructions actually came from.
//
// `build()` hardcoded "from AGENTS.md" while `BASE_NAMES` accepts THEO.md, AGENTS.md AND CLAUDE.md
// (plus the LOCAL_NAMES chain). A project carrying only `CLAUDE.md` was therefore told its
// instructions came from a file that does not exist in it.
//
// Measured 2026-09-15: a canary token was appended to `CLAUDE.md` — the only instruction file in
// that project — and the running agent reported it as coming from "AGENTS.md". A reader who goes
// looking for that file finds nothing, and an agent asked where a rule came from answers with a
// path nobody can open. Naming a source that is not there is worse than naming none.

import { describe, expect, it } from 'vitest'

import { composeInstructions } from '../../src/context/agents-md.js'

const BASE = 'base persona'
const DOC = 'project rule text'

describe('composeInstructions — source attribution', () => {
  it('names the file the project document actually came from', () => {
    const { text } = composeInstructions(BASE, DOC, '', undefined, ['CLAUDE.md'])
    expect(text).toContain('CLAUDE.md')
    expect(text).not.toContain('AGENTS.md')
  })

  it('names every file when the chain has more than one', () => {
    const { text } = composeInstructions(BASE, DOC, '', undefined, ['AGENTS.md', 'AGENTS.local.md'])
    expect(text).toContain('AGENTS.md')
    expect(text).toContain('AGENTS.local.md')
  })

  it('names no file rather than the wrong one when the sources are unknown', () => {
    // The honest fallback. An unqualified header beats a header pointing at a file the reader
    // cannot open — the failure this test exists to close.
    const { text } = composeInstructions(BASE, DOC)
    expect(text).toContain('Project instructions')
    expect(text).not.toContain('AGENTS.md')
  })

  it('still carries the document itself', () => {
    expect(composeInstructions(BASE, DOC, '', undefined, ['THEO.md']).text).toContain(DOC)
  })
})
