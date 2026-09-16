// The declaration the SDK now carries, turned into something the subagent can read.
//
// `@theokit/sdk` stops at `AgentDefinition.memory` on purpose: which of three roots a note lives
// under is a decision about who can see it, and a second copy of that rule there is how the two
// packages drift into disagreeing about privacy. `resolveAgentMemory` owns it here — and until this
// existed, it owned it with no caller. The reader and the declaration were one function call apart
// for as long as both existed.
//
// The reference loads a subagent's `MEMORY.md` into its system prompt. Here the prompt is the
// definition's own `prompt`, so that is where the notes go: appended, marked, and only when there
// are notes to append.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applySubagentMemory } from '../../src/config/agent-memory.js'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function projectWith(
  agent: string,
  notes: string | undefined,
  root = '.claude/agent-memory',
): string {
  const cwd = mkdtempSync(join(tmpdir(), 'apply-memory-'))
  made.push(cwd)
  if (notes !== undefined) {
    const dir = join(cwd, root, agent)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'MEMORY.md'), notes)
  }
  return cwd
}

const DEF = { description: 'd', prompt: 'the body' }

describe('applySubagentMemory', () => {
  it('appends the notes to the prompt the subagent receives', () => {
    const cwd = projectWith('auditor', 'remember the postgres timeout')
    const out = applySubagentMemory({ ...DEF, memory: 'project' }, 'auditor', cwd)
    expect(out.prompt).toContain('the body')
    expect(out.prompt).toContain('remember the postgres timeout')
  })

  it('leaves a definition without a declaration exactly as it was', () => {
    const cwd = projectWith('auditor', 'notes nobody asked for')
    expect(applySubagentMemory(DEF, 'auditor', cwd)).toEqual(DEF)
  })

  it('leaves the prompt alone when the declaration points at nothing yet', () => {
    // An agent declaring `memory:` before writing its first note is the ordinary first run.
    const cwd = projectWith('auditor', undefined)
    const out = applySubagentMemory({ ...DEF, memory: 'project' }, 'auditor', cwd)
    expect(out.prompt).toBe('the body')
  })

  it('refuses an unrecognised scope rather than defaulting it', () => {
    // `resolveAgentMemory` refuses because the three roots differ in WHO CAN SEE the notes, and
    // guessing `project` would publish, on the next commit, something written expecting privacy.
    // This must not soften that into a silent no-op.
    const cwd = projectWith('auditor', 'private')
    expect(() => applySubagentMemory({ ...DEF, memory: 'made-up' }, 'auditor', cwd)).toThrow(
      /made-up|scope/i,
    )
  })

  it('marks where the notes came from, so the model is not told they are instructions', () => {
    const cwd = projectWith('auditor', 'the note')
    const out = applySubagentMemory({ ...DEF, memory: 'project' }, 'auditor', cwd)
    expect(out.prompt).toMatch(/memory|notes/i)
  })

  it('does not mutate the definition it was given', () => {
    const cwd = projectWith('auditor', 'the note')
    const input = { ...DEF, memory: 'project' }
    const snapshot = JSON.stringify(input)
    applySubagentMemory(input, 'auditor', cwd)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
