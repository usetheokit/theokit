/**
 * B-080 — the warning has to arrive BEFORE the failure, and only once it means something.
 */
import { describe, expect, it } from 'vitest'

import { CRITICAL_AT, WARN_AT, contextPressure, contextWarning } from '../../src/formatting/context-pressure.js'

describe('B-080 — contextPressure', () => {
  it('test_an_empty_conversation_is_ok', () => {
    expect(contextPressure(0, 200_000)).toBe('ok')
    expect(contextPressure(1_000, 200_000)).toBe('ok')
  })

  it('test_it_warns_at_the_threshold_not_after_it', () => {
    // `>=`, deliberately: a warning that fires one token late is a warning that can be skipped
    // entirely by a single large turn.
    expect(contextPressure(WARN_AT * 200_000, 200_000)).toBe('warn')
    expect(contextPressure(WARN_AT * 200_000 - 1, 200_000)).toBe('ok')
  })

  it('test_critical_outranks_warn', () => {
    expect(contextPressure(CRITICAL_AT * 200_000, 200_000)).toBe('critical')
    expect(contextPressure(199_000, 200_000)).toBe('critical')
  })

  it('test_an_unknown_window_never_raises_the_alarm', () => {
    // The window is `fallback`-resolved for models with no catalogue entry. Firing `critical` there
    // would cry wolf on every session using one, which is how a warning gets ignored.
    expect(contextPressure(500_000, 0)).toBe('ok')
    expect(contextPressure(500_000, -1)).toBe('ok')
  })
})

describe('B-080 — contextWarning', () => {
  it('test_ok_says_nothing', () => {
    // Anti-noise floor: a message at every level is a message at no level.
    expect(contextWarning('ok')).toBeUndefined()
  })

  it('test_both_warnings_name_the_remedy', () => {
    // A warning without the remedy is just anxiety.
    expect(contextWarning('warn')).toContain('/compact')
    expect(contextWarning('critical')).toContain('/compact')
  })

  it('test_critical_says_what_is_at_stake', () => {
    expect(contextWarning('critical')).toContain('fail')
  })

  it('test_the_warning_says_what_compacting_costs', () => {
    // So the user is choosing rather than obeying: compaction is not free, it drops detail.
    expect(contextWarning('warn')).toContain('summarizes')
    expect(contextWarning('critical')).toContain('summarizes')
  })
})
