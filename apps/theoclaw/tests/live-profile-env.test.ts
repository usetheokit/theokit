import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `startInstance` always sets THEOCLAW_PROFILE, which TheoClaw refuses to share a start with
 * THEOCLAW_WORKSPACE (#1414). Live tests run only on a dispatch, so this reads them offline.
 */
const LIVE = join(fileURLToPath(new URL('.', import.meta.url)), 'live')

describe('live tests keep profile and workspace apart', () => {
  it('no live test that starts a profiled instance sets THEOCLAW_WORKSPACE', () => {
    const offenders = readdirSync(LIVE)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => {
        const source = readFileSync(join(LIVE, name), 'utf8')
        return /startInstance\(/.test(source) && /THEOCLAW_WORKSPACE/.test(source)
      })
    expect(offenders).toEqual([])
  })
})
