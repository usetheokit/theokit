import { describe, expect, it } from 'vitest'

import { backupSkipReason } from './live/support/backup-target.js'

describe('the live backup test without a target (#1416)', () => {
  it('skips with THEOCLAW_BACKUP_TARGET named in the reason when it is unset', () => {
    expect(backupSkipReason({})).toContain('THEOCLAW_BACKUP_TARGET is unset')
  })
  it('runs when a target is set', () => {
    expect(backupSkipReason({ THEOCLAW_BACKUP_TARGET: 'https://backup.example/x' })).toBeUndefined()
  })
})
