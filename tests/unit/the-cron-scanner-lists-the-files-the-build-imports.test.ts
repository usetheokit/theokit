import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  cronScanDirs,
  isDiscoverableCronFile,
  listCronFiles,
} from '../../packages/theo/src/server/cron/cron-scan.js'

/**
 * Which files the build imports as crons, and from where. The schedule generator reads the same
 * three answers to decide where a schedule goes and whether its name is taken, so each is pinned
 * here directly rather than only through a generated schedule.
 */
describe('the cron scanner lists the files the build imports', () => {
  it.each([
    ['daily.ts', true],
    ['_helper.ts', false],
    ['.ts', false],
    ['.DS_Store', false],
  ])('test_a_file_named_%s_is_discoverable_%s', (fileName, discoverable) => {
    expect(isDiscoverableCronFile(fileName)).toBe(discoverable)
  })

  it('test_listing_merges_both_homes_and_skips_a_missing_one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'theo-cron-list-'))
    try {
      mkdirSync(join(dir, 'crons/nested'), { recursive: true })
      mkdirSync(join(dir, 'schedules'), { recursive: true })
      for (const file of ['crons/a.ts', 'crons/nested/b.mjs', 'crons/_c.ts', 'crons/d.md']) {
        writeFileSync(join(dir, file), '')
      }
      writeFileSync(join(dir, 'schedules/e.ts'), '')

      const listed = listCronFiles([
        join(dir, 'crons'),
        join(dir, 'missing'),
        join(dir, 'schedules'),
      ])

      expect(listed).toEqual([
        join(dir, 'crons/a.ts'),
        join(dir, 'crons/nested/b.mjs'),
        join(dir, 'schedules/e.ts'),
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('test_the_cron_homes_are_server_crons_and_agent_schedules_under_the_project', () => {
    expect(cronScanDirs('/p/app', 'src/server', 'src/server/agents')).toEqual({
      crons: '/p/app/src/server/crons',
      schedules: '/p/app/src/server/agents/schedules',
    })
    // The build hands over serverDir already resolved; an absolute directory is kept as is.
    expect(cronScanDirs('/p/app', '/p/app/server', 'agents').crons).toBe('/p/app/server/crons')
  })
})
