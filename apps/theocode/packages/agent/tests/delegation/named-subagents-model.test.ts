import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { namedSubagentDefinitions } from '../../src/delegation/named-subagents.js'

let cwd: string
let home: string
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-model-cwd-'))
  home = mkdtempSync(join(tmpdir(), 'theocode-model-home-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('a subagent model survives registration', () => {
  it('test_the_model_from_the_file_reaches_the_registered_definition', async () => {
    mkdirSync(join(cwd, '.theokit', 'agents'), { recursive: true })
    writeFileSync(
      join(cwd, '.theokit', 'agents', 'auditor.md'),
      '---\nname: auditor\ndescription: audits\nmodel: openai/gpt-5\n---\nbody\n',
    )
    writeFileSync(
      join(cwd, '.theokit', 'agents', 'plain.md'),
      '---\nname: plain\ndescription: plain\n---\nbody\n',
    )

    const defs = await namedSubagentDefinitions(cwd, true, home)

    expect(defs['auditor']?.model).toEqual(expect.objectContaining({ id: 'openai/gpt-5' }))
    expect(defs['plain']?.model).toBeUndefined()
  })
})
