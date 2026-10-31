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

  // B-371: an operator who does not know THEOCLAW_OWNERS is required cannot start the instance.
  it('announces the owner policy and the README documents its six variables', () => {
    expect(unreleased()).toContain('B-371')
    expect(unreleased()).toContain('THEOCLAW_OWNERS')
    const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')
    for (const variable of [
      'THEOCLAW_OWNERS',
      'THEOCLAW_DM_POLICY',
      'THEOCLAW_GROUP_ACTIVATION',
      'THEOCLAW_REFUSAL_TEXT',
      'THEOCLAW_STATE_DIR',
      'THEOCLAW_BROADCAST_GROUPS',
    ]) {
      expect(readme).toContain(variable)
    }
  })

  it('announces the core tools (B-382)', () => {
    const section = unreleased()

    expect(section).toContain('B-382')
    expect(section).toContain('THEOCLAW_HOST_TOOLS')
    expect(section).toContain('BRAVE_API_KEY')
    expect(section).toContain('read every file')
  })

  it('announces the digest workflow tool (B-387)', () => {
    const section = unreleased()

    expect(section).toContain('B-387')
    expect(section).toContain('`digest`')
    expect(section).toContain('/control')
  })
})
