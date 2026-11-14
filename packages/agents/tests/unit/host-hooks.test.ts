import { describe, expect, it } from 'vitest'

import { hookFingerprint, runHostHooks, type HookSpec } from '../../src/hooks/index.js'

function spec(
  command: string,
  event: HookSpec['event'] = 'on_session_start',
  timeout_ms = 5000,
): HookSpec {
  return { event, command, timeout_ms } as HookSpec
}
const fp = (s: HookSpec): string =>
  hookFingerprint({ command: s.command, event: s.event, timeoutMs: s.timeout_ms })
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' }

describe('runHostHooks', () => {
  it('runHostHooks runs only approved specs of the given event', async () => {
    const ok = spec('echo hi')
    const unapproved = spec('echo no')
    const other = spec('echo other', 'post_tool_call')
    const warns: string[] = []
    const out = await runHostHooks('on_session_start', [ok, unapproved, other], {
      trusted: true,
      approved: new Set([fp(ok), fp(other)]),
      cwd: process.cwd(),
      env,
      onWarn: (m) => warns.push(m),
    })
    expect(
      out.map((o) => [o.spec.command, o.status]).sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([
      ['echo hi', 'ran'],
      ['echo no', 'not-approved'],
    ])
    expect(out.find((o) => o.status === 'ran')?.result?.stdout).toContain('hi')
    expect(warns).toHaveLength(1)
  })

  it('an untrusted directory runs nothing and warns once', async () => {
    const a = spec('echo a')
    const b = spec('echo b')
    const warns: string[] = []
    const out = await runHostHooks('on_session_start', [a, b], {
      trusted: false,
      approved: new Set([fp(a), fp(b)]),
      cwd: process.cwd(),
      env,
      onWarn: (m) => warns.push(m),
    })
    expect(out).toEqual([])
    expect(warns).toHaveLength(1)
  })

  it('a hook does not see a variable that is in process.env and not in options.env', async () => {
    process.env.THEOKIT_HOST_HOOK_LEAK = 'leaked'
    try {
      const s = spec('echo "[$THEOKIT_HOST_HOOK_LEAK][$KEPT]"')
      const out = await runHostHooks('on_session_start', [s], {
        trusted: true,
        approved: new Set([fp(s)]),
        cwd: process.cwd(),
        env: { ...env, KEPT: 'yes' },
      })
      expect(out[0]?.result?.stdout.trim()).toBe('[][yes]')
    } finally {
      delete process.env.THEOKIT_HOST_HOOK_LEAK
    }
  })

  it('a non-zero exit and a timeout are reported as outcomes and do not throw', async () => {
    const bad = spec('exit 3')
    const slow = spec('sleep 5', 'on_session_start', 100)
    const out = await runHostHooks('on_session_start', [bad, slow], {
      trusted: true,
      approved: new Set([fp(bad), fp(slow)]),
      cwd: process.cwd(),
      env,
    })
    expect(out.map((o) => o.status)).toEqual(['failed', 'timed-out'])
    expect(out[0]?.result?.exitCode).toBe(3)
  })
})
