/**
 * SDK 4.0 (SE40) — the framework roots the native `.jsonl` session transcript per-app. EC-2: it MUST
 * live under `.data/`, NOT inside the `.theokit/` config dir, so a transcript `projects/` subtree can
 * never be mis-read by `settingSources(['project'])` discovery (which scans `.theokit/{skills,agents,…}`).
 */
import { describe, expect, it } from 'vitest'

import { resolveSessionBaseDir } from '../../packages/theo/src/server/agent/mount-agent.js'

describe('resolveSessionBaseDir — native session transcript root', () => {
  it('roots the transcript under <projectRoot>/.data/agent-sessions', () => {
    expect(resolveSessionBaseDir('/app')).toBe('/app/.data/agent-sessions')
  })

  it('keeps the transcript OUT of .theokit/ (EC-2 — no settingSources discovery collision)', () => {
    const p = resolveSessionBaseDir('/app')
    expect(p).toContain('/.data/agent-sessions')
    expect(p).not.toContain('/.theokit')
  })

  it('strips a trailing slash on projectRoot (never emits `//`)', () => {
    expect(resolveSessionBaseDir('/app/')).toBe('/app/.data/agent-sessions')
  })

  it('returns undefined when projectRoot is unknown (SDK default `~/.theokit` applies)', () => {
    expect(resolveSessionBaseDir(undefined)).toBeUndefined()
  })
})
