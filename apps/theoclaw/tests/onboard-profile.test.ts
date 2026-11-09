import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { onboard } from '../src/onboard.js'
import { FLAGS, cleanScratch, configFile, harness, refusal } from './support/onboard-harness.js'

afterEach(cleanScratch)

describe('theoclaw onboard under a profile', () => {
  it('a profiled onboarding refuses a workspace the profile does not own and writes nothing', async () => {
    const h = harness({ THEOCLAW_PROFILE: 'a' })
    const error = await refusal(onboard({ ...FLAGS, workspace: join(h.home, 'elsewhere') }, h.io))
    expect(error.variable).toBe('THEOCLAW_WORKSPACE')
    expect(error.message).toContain('THEOCLAW_PROFILE')
    expect(existsSync(configFile(h, 'theoclaw-a.env'))).toBe(false)
    expect(existsSync(join(h.home, 'elsewhere'))).toBe(false)
  })
})
