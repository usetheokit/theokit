import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadCronDefinitions } from '../../packages/theo/src/cli/commands/start/cron-bootstrap.js'

/**
 * theokit#324 — `theokit build --target node` prints
 * "Cron → in-process scheduler (theokit start)", but `theokit start` never
 * read the manifest it wrote. These tests pin the reader that closes the gap.
 */

function manifestDir(crons: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'theokit-cron-'))
  writeFileSync(
    join(dir, 'crons.json'),
    JSON.stringify({ schemaVersion: 1, generatedAt: '2026-08-18T00:00:00.000Z', crons }),
  )
  return dir
}

describe('loadCronDefinitions (theokit#324)', () => {
  it('returns no definitions when the build wrote no manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theokit-cron-'))

    const defs = await loadCronDefinitions(join(dir, 'crons.json'), dir, () => {
      throw new Error('must not load any module')
    })

    expect(defs).toEqual([])
  })

  it('loads the handler of every cron the manifest declares', async () => {
    const dir = manifestDir([
      {
        name: 'nightly',
        filePath: 'server/crons/nightly.ts',
        schedule: '0 3 * * *',
        concurrency: 'forbid',
      },
    ])
    const handler = (): void => {}

    const defs = await loadCronDefinitions(join(dir, 'crons.json'), dir, (path) => {
      expect(path).toBe(join(dir, 'server/crons/nightly.ts'))
      return Promise.resolve({
        default: { name: 'nightly', schedule: '0 3 * * *', handler, concurrency: 'forbid' },
      })
    })

    expect(defs).toEqual([
      { name: 'nightly', schedule: '0 3 * * *', handler, concurrency: 'forbid' },
    ])
  })

  it('fails loudly when a declared cron file lost its default export', async () => {
    const dir = manifestDir([
      {
        name: 'nightly',
        filePath: 'server/crons/nightly.ts',
        schedule: '0 3 * * *',
        concurrency: 'forbid',
      },
    ])

    await expect(
      loadCronDefinitions(join(dir, 'crons.json'), dir, () => Promise.resolve({})),
    ).rejects.toThrow(/nightly\.ts/)
  })
})
