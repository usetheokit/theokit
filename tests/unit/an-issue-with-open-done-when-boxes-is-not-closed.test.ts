/** #2609: a partial pull request must not close an umbrella issue without a named follow-up. */
import { describe, expect, it } from 'vitest'
import {
  decideClosure,
  namedFollowUp,
  uncheckedDoneWhen,
} from '../../scripts/lib/issue-closure.mjs'

const partial = '## Done when\n\n- [x] a\n- [ ] b\n- [ ] c\n\n---\nnotes'
const done = '## Done when\n\n- [x] a\n- [X] b\n'

describe('issue closure', () => {
  it('lists unchecked boxes only inside Done when', () => {
    expect(uncheckedDoneWhen(partial)).toEqual(['b', 'c'])
    expect(uncheckedDoneWhen('## Done when\n- [x] a\n## Other\n- [ ] z')).toEqual([])
    expect(uncheckedDoneWhen('no section\n- [ ] x')).toEqual([])
  })

  it('keeps an issue open when boxes are unchecked and no follow-up is named', () => {
    const d = decideClosure({ issueNumber: 1841, issueBody: partial, prBody: 'Closes #1841' })
    expect(d.action).toBe('keep-open')
  })

  it('closes with a follow-up link when the pull request names one', () => {
    const d = decideClosure({
      issueNumber: 1841,
      issueBody: partial,
      prBody: 'x\nFollow-up: #2595\n',
    })
    expect(d).toMatchObject({ action: 'close', followUp: 2595 })
    expect(d.closingNote).toContain('#2595')
  })

  it('does not accept the issue itself or a malformed reference as follow-up', () => {
    expect(namedFollowUp('Follow-up: #1841', 1841)).toBeUndefined()
    expect(namedFollowUp('Follow-up: soon')).toBeUndefined()
    expect(namedFollowUp(undefined)).toBeUndefined()
  })

  it('closes a fully checked issue and one without the section', () => {
    expect(decideClosure({ issueNumber: 1, issueBody: done, prBody: '' }).action).toBe('close')
    expect(decideClosure({ issueNumber: 1, issueBody: 'plain', prBody: '' }).action).toBe('close')
  })

  it('fails closed when the issue body cannot be read', () => {
    expect(decideClosure({ issueNumber: 1, issueBody: undefined, prBody: '' }).action).toBe(
      'keep-open',
    )
  })
})
