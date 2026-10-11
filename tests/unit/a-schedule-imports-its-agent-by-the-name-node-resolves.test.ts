import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  cronNameOf,
  importSpecifier,
} from '../../packages/theo/src/cli/commands/generate-schedule.js'

/**
 * The two pure rules behind a generated schedule, pinned at the unit layer: the specifier it
 * imports its agent by (buggy once inside this change, fixed in 9b8f53a0) and the cron name it
 * declares.
 */
describe('a schedule imports its agent by the name node resolves', () => {
  const schedules = join('/app', 'src/server/agents/schedules')

  it.each([
    ['chat.ts', join('/app', 'src/server/agents/chat.ts'), '../chat.js'],
    ['chat.tsx', join('/app', 'src/server/agents/chat.tsx'), '../chat.js'],
    ['chat.js', join('/app', 'src/server/agents/chat.js'), '../chat.js'],
    ['chat.jsx', join('/app', 'src/server/agents/chat.jsx'), '../chat.jsx'],
    ['chat/index.ts', join('/app', 'src/server/agents/chat/index.ts'), '../chat/index.js'],
  ])('test_an_agent_at_%s_is_imported_as_its_specifier', (_label, agentFile, expected) => {
    expect(importSpecifier(join(schedules, 'daily.ts'), agentFile)).toBe(expected)
  })

  it('test_a_sibling_file_gets_a_dot_slash_specifier', () => {
    expect(importSpecifier(join(schedules, 'daily.ts'), join(schedules, 'chat.ts'))).toBe(
      './chat.js',
    )
  })

  it.each([
    ['daily-digest', 'daily-digest'],
    ['reports/weekly', 'weekly'],
    ['a/b/c', 'c'],
  ])('test_the_schedule_%s_declares_the_cron_name_%s', (name, expected) => {
    expect(cronNameOf(name)).toBe(expected)
  })
})
