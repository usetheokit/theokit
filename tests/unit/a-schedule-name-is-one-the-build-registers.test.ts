import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { generate } from '../../packages/theo/src/cli/commands/generate.js'

/**
 * B-411, review finding #90: `theokit generate schedule` writes `defineCron('<last segment>')`
 * into `<agentsDir>/schedules/<name>.ts`. A name is accepted only when `theokit build` would
 * register what it writes: the last segment passes `defineCron`'s own name rule, the file is one
 * the cron scanner discovers, and no other cron file already uses that name. Anything else is
 * refused as `invalid_name` and nothing is written, instead of reporting `created` for a file the
 * build then rejects or never sees.
 */
const REPO = resolve(__dirname, '../..')
const SCAFFOLD_CONFIG = resolve(REPO, 'packages/create-theokit/templates/default/theo.config.ts')
const SCHEDULES = 'src/server/agents/schedules'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-name-'))
  copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
  writeFileSync(join(dir, 'package.json'), '{}')
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(dir, 'node_modules/theokit'), 'dir')
  mkdirSync(join(dir, 'src/server/agents'), { recursive: true })
  writeFileSync(join(dir, 'src/server/agents/chat.ts'), 'export default {}\n')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const schedule = (name: string) => generate({ cwd: dir, type: 'schedule', name })

describe('theokit generate schedule accepts only a name the build registers', () => {
  it('test_a_name_ending_in_a_slash_is_refused_and_writes_nothing', async () => {
    const result = await schedule('nightly/')

    expect(result.status).toBe('invalid_name')
    expect(existsSync(join(dir, SCHEDULES))).toBe(false)
  })

  it('test_a_last_segment_defineCron_rejects_is_refused', async () => {
    const result = await schedule('team/-x')

    expect(result.status).toBe('invalid_name')
    expect(result.message).toContain('"-x"')
    expect(existsSync(join(dir, SCHEDULES))).toBe(false)
  })

  it('test_a_last_segment_longer_than_64_characters_is_refused', async () => {
    const result = await schedule(`team/a${'b'.repeat(64)}`)

    expect(result.status).toBe('invalid_name')
    expect(existsSync(join(dir, SCHEDULES))).toBe(false)
  })

  it('test_a_second_schedule_with_the_same_cron_name_is_refused', async () => {
    expect((await schedule('a/report')).status).toBe('created')

    const result = await schedule('b/report')

    expect(result.status).toBe('invalid_name')
    expect(result.message).toContain(join(dir, SCHEDULES, 'a/report.ts'))
    expect(existsSync(join(dir, SCHEDULES, 'b'))).toBe(false)
  })

  it('test_a_server_cron_with_the_same_name_is_refused', async () => {
    mkdirSync(join(dir, 'src/server/crons'), { recursive: true })
    writeFileSync(join(dir, 'src/server/crons/report.ts'), 'export default {}\n')

    const result = await schedule('report')

    expect(result.status).toBe('invalid_name')
    expect(result.message).toContain(join(dir, 'src/server/crons/report.ts'))
    expect(existsSync(join(dir, SCHEDULES))).toBe(false)
  })

  it('test_a_valid_nested_name_is_still_created', async () => {
    const result = await schedule('team/weekly-report')

    expect(result.status).toBe('created')
    expect(readdirSync(join(dir, SCHEDULES, 'team'))).toEqual(['weekly-report.ts'])
  })
})
