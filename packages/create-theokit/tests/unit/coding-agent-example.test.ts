import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('the scaffold teaches the coding agent through its preset', () => {
  it('the agents skill shows codingAgentPreset with an explicit sandbox mode and posture', () => {
    const skill = readFileSync(
      join(__dirname, '../../templates/default/dot-claude/skills/theokit-agents/SKILL.md'),
      'utf8',
    )
    expect(skill).toContain('codingAgentPreset({')
    expect(skill).toMatch(/sandboxMode: 'read-only'/)
    expect(skill).toContain('posture:')
  })
})
