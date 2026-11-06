import { describe, expect, it } from 'vitest'

import { projectRelativeExcludes } from '../vitest.config.js'

describe('TheoClaw factory test exclusions', () => {
  it('translates explicitly excluded repository paths to project paths', () => {
    expect(projectRelativeExcludes([
      '--exclude', 'apps/theoclaw/tests/sandbox-confinement.test.ts',
      '--exclude', 'apps/theoclaw/tests/live/tools.live.test.ts',
    ])).toEqual(['tests/sandbox-confinement.test.ts', 'tests/live/tools.live.test.ts'])
  })

  it('adds no exclusions unless this project was explicitly excluded', () => {
    expect(projectRelativeExcludes([])).toEqual([])
    expect(projectRelativeExcludes([
      'apps/theoclaw/tests/telemetry.test.ts',
      '--exclude', 'packages/agents/tests/unit/sandbox.test.ts',
      '--exclude', '**/tests/other.test.ts',
      '--exclude',
    ])).toEqual([])
  })
})
