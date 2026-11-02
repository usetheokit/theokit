import { resolveSandboxPosture } from '@theokit/agents/sandbox'
import { describe, expect, it } from 'vitest'

import { sandboxRequirement } from './sandbox-requirement.js'

const unenforced = { enforced: false, detail: 'no bubblewrap here' }
const enforced = { enforced: true, detail: 'bubblewrap' }

describe('sandboxRequirement', () => {
  it('throws, naming the flag and the detail, when the flag is set and the sandbox is not enforced', () => {
    expect(() => sandboxRequirement({ THEOCLAW_REQUIRE_SANDBOX: '1' }, unenforced)).toThrow(/THEOCLAW_REQUIRE_SANDBOX.*no bubblewrap here/)
  })

  it('skips when the flag is unset and the sandbox is not enforced', () => {
    expect(sandboxRequirement({}, unenforced)).toBe('skip')
  })

  it('runs when the sandbox is enforced, with or without the flag', () => {
    expect(sandboxRequirement({}, enforced)).toBe('run')
    expect(sandboxRequirement({ THEOCLAW_REQUIRE_SANDBOX: '1' }, enforced)).toBe('run')
  })
})

describe('this machine', () => {
  // THEOCLAW_REQUIRE_SANDBOX=1 (set by the CI theoclaw job) makes an unenforced sandbox a failure here.
  it('enforces the sandbox wherever THEOCLAW_REQUIRE_SANDBOX=1 requires it', () => {
    const posture = resolveSandboxPosture({ mode: 'workspace-write' })
    expect(() => sandboxRequirement(process.env, posture)).not.toThrow()
  })
})
