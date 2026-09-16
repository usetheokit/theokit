import { describe, expect, it } from 'vitest'

import { BASE_INSTRUCTIONS } from '../../src/context/instructions.js'

/**
 * BASE_INSTRUCTIONS is a behavioural contract, not prose: every rule below was added because a
 * measured run misbehaved without it. These tests pin the invariants, not the exact wording.
 */
describe('BASE_INSTRUCTIONS', () => {
  it('keeps every operating-protocol section', () => {
    for (const heading of [
      '## Operating protocol',
      '## Preamble messages',
      '## Editing constraints',
      '## Tools',
      '## Implement the rule, not the example',
      '## Working a coding task',
      '## Special requests',
      '## Final-answer style',
      '## Skills',
    ]) {
      expect(BASE_INSTRUCTIONS).toContain(heading)
    }
  })

  it('numbers the operating protocol from 1 to 6 with no gaps', () => {
    const numbers = [...BASE_INSTRUCTIONS.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('cross-references point at the rules they name', () => {
    // §4 is grounding and §6 is the closing recap; renumbering must not orphan the pointers.
    expect(BASE_INSTRUCTIONS).toMatch(/4\. \*\*GROUND every fact in a tool call/)
    expect(BASE_INSTRUCTIONS).toMatch(/6\. \*\*ALWAYS END THE TURN WITH A PROSE RECAP/)
    for (const ref of [...BASE_INSTRUCTIONS.matchAll(/§(\d)/g)].map((m) => Number(m[1]))) {
      expect([1, 2, 4, 6]).toContain(ref)
    }
  })

  describe('load-bearing rigour rules survive', () => {
    it('requires grounding before asserting', () => {
      expect(BASE_INSTRUCTIONS).toContain('call the tool FIRST, answer AFTER its result')
      expect(BASE_INSTRUCTIONS).toContain('do not answer, then verify')
      expect(BASE_INSTRUCTIONS).toContain('Never answer from memory')
    })

    it('requires a prose preamble before a burst of tool calls', () => {
      expect(BASE_INSTRUCTIONS).toContain('Before a burst of tool calls, send a brief **preamble**')
    })

    it('requires the closing prose recap on every turn that ran a tool', () => {
      expect(BASE_INSTRUCTIONS).toContain('ALWAYS END THE TURN WITH A PROSE RECAP')
      expect(BASE_INSTRUCTIONS).toContain('MANDATORY on every turn that ran a tool')
      expect(BASE_INSTRUCTIONS).toMatch(/the turn is INCOMPLETE/i)
    })

    it('forbids inventing extra deliverables', () => {
      expect(BASE_INSTRUCTIONS).toContain('DO EXACTLY WHAT WAS ASKED')
      expect(BASE_INSTRUCTIONS).toContain('Never invent extra deliverables')
    })

    it('does not let the round-economy rule read as a licence to skip rigour', () => {
      expect(BASE_INSTRUCTIONS).toContain(
        'This cuts REDUNDANT rounds only: §4 grounding and the §6 recap are never what you trim.',
      )
    })
  })

  describe('round-economy rules', () => {
    it('forbids exploring for files the prompt already named', () => {
      expect(BASE_INSTRUCTIONS).toContain('The prompt named the files? `read_file` them directly')
      expect(BASE_INSTRUCTIONS).toContain('to rediscover a path you were handed')
    })

    it('asks for known reads in one turn', () => {
      expect(BASE_INSTRUCTIONS).toContain('Request those reads together in one turn')
    })

    it('forbids re-reading a file to confirm your own patch', () => {
      expect(BASE_INSTRUCTIONS).toContain('NEVER re-read a file to confirm your own patch')
      expect(BASE_INSTRUCTIONS).toContain("don't re-read to check")
    })

    it('keeps repo_status off the pre-edit warm-up path', () => {
      expect(BASE_INSTRUCTIONS).toContain('`repo_status` ONLY when the task is about git state')
      expect(BASE_INSTRUCTIONS).toContain('it is not a warm-up before editing')
    })

    it('binds the anti-plan rule to linear tasks and never invites a plan elsewhere', () => {
      expect(BASE_INSTRUCTIONS).toContain('**Default to NO plan')
      expect(BASE_INSTRUCTIONS).toContain('is LINEAR: no plan at all')
      expect(BASE_INSTRUCTIONS).toContain('NEVER make a single-step plan')
      expect(BASE_INSTRUCTIONS).toContain('never spend a call ticking the last box')
      // The coding-task loop used to open with "plan first", contradicting rule 1.
      expect(BASE_INSTRUCTIONS).not.toContain('plan first')
    })

    it('pins the run to the exact command the task names', () => {
      expect(BASE_INSTRUCTIONS).toContain('Run the EXACT command the task names')
    })
  })

  describe('solve the requirement, not the quoted example', () => {
    it('treats a spec example as an illustration of a rule', () => {
      expect(BASE_INSTRUCTIONS).toContain(
        'An example in a spec ILLUSTRATES a rule; it never defines it',
      )
      expect(BASE_INSTRUCTIONS).toContain('Implement the rule as stated')
      expect(BASE_INSTRUCTIONS).toContain(
        'Never special-case the literal values named in the requirement',
      )
    })

    it('requires self-written tests to reach beyond what the implementation is known to handle', () => {
      expect(BASE_INSTRUCTIONS).toContain(
        'include cases you did NOT already know your code handles',
      )
      expect(BASE_INSTRUCTIONS).toContain('green on it is not evidence')
    })
  })

  it('stays within its character budget', () => {
    // Measured size of the pre-tightening prompt. Additions must be paid for by cuts.
    expect(BASE_INSTRUCTIONS.length).toBeLessThanOrEqual(9523)
  })

  it('escapes every backtick and template placeholder', () => {
    expect(BASE_INSTRUCTIONS).not.toContain('${')
    expect(BASE_INSTRUCTIONS.length).toBeGreaterThan(0)
  })
})
