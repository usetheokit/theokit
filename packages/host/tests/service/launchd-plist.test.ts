import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { launchdPlist } from '../../src/service/index.js'

const nasty = `a<b&c"d'e`
const spec = {
  label: nasty,
  command: '/usr/bin/node',
  args: ['/srv/' + nasty],
  env: { TOKEN: nasty },
  workingDirectory: '/srv/' + nasty,
}

describe('launchdPlist', () => {
  it('escapes <, &, " and \' in every value', () => {
    const text = launchdPlist(spec, { logFile: '/logs/' + nasty })
    expect(text).not.toContain(nasty)
    expect(text).toContain('a&lt;b&amp;c&quot;d&apos;e')
    expect(text).toContain('<key>SuccessfulExit</key>')
    expect(text).toContain('<key>RunAtLoad</key>')
    expect(text).toContain('<key>StandardErrorPath</key>')
  })

  it.skipIf(process.platform !== 'darwin')(
    'parses with plutil -lint (skipped: plutil only exists on macOS)',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'plist-'))
      try {
        const file = join(dir, 'a.plist')
        writeFileSync(file, launchdPlist(spec, { logFile: '/logs/x.log' }))
        expect(spawnSync('/usr/bin/plutil', ['-lint', file]).status).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
