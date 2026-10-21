import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The `[Unreleased]` section of this app's CHANGELOG, up to the next release heading. */
function unreleased(): string {
  const changelog = readFileSync(join(__dirname, '..', 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf('## [Unreleased]')
  const next = changelog.indexOf('\n## [', start + 1)
  return start === -1 ? '' : changelog.slice(start, next === -1 ? undefined : next)
}

/**
 * The channel loop is visible to whoever runs the app (Unbreakable Rule 6), and the app is private,
 * so no changeset records it: the CHANGELOG entry is the record, and this checks it says what an
 * operator needs.
 */
describe('the CHANGELOG', () => {
  it('announces the channel loop', () => {
    const section = unreleased()

    expect(section).toContain('THEOCLAW_PORT')
    expect(section).toContain('/webhooks/line')
    expect(section).toContain('push API')
    expect(section).toContain('130497')
  })
})
