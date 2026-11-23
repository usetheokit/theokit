import { Writable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/sessions/transcript-gc.js', () => ({
  collectTranscripts: () =>
    Promise.resolve({
      dryRun: false,
      removed: ['theoclaw-a-g0'],
      orphaned: [],
      errors: ['theoclaw-b-g0: EACCES'],
    }),
}))

import { sessionsCommand } from '../src/sessions/sessions-command.js'
import { scratchDir } from './support/cli-harness.js'

describe('theoclaw sessions gc errors', () => {
  it('keeps per-transcript errors on stderr and exits 1, in both report modes', async () => {
    for (const flags of [[], ['--json']]) {
      const workspace = scratchDir()
      let out = ''
      let err = ''
      const io = {
        env: { THEOCLAW_WORKSPACE: workspace },
        homeDir: workspace,
        stdout: new Writable({ write: (c, _e, d) => ((out += String(c)), d()) }),
        stderr: new Writable({ write: (c, _e, d) => ((err += String(c)), d()) }),
      }
      expect(await sessionsCommand(['gc', ...flags], io)).toBe(1)
      expect(err).toBe('theoclaw: theoclaw-b-g0: EACCES\n')
      if (flags.length > 0) expect(JSON.parse(out)).toMatchObject({ type: 'sessions.gc' })
      else expect(out).not.toContain('EACCES')
      if (flags.length === 0) expect(out).toContain('removed theoclaw-a-g0')
    }
  })
})
