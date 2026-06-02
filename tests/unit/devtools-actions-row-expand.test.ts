/**
 * RED tests for ActionsTab row-level expand/collapse.
 *
 * Goal: mirror the RequestsTab pattern — each action row is a click-to-
 * toggle button, details render inline under the row when expanded, and
 * the row's aria-expanded state mirrors the toggle. No global "selected"
 * state — each row is independent. JSONExplorer for input/output bodies
 * gives nested collapsibility (parity with RequestsTab body inspector).
 */
import { describe, expect, it } from 'vitest'

import {
  computeActionsTabIds,
  toggleExpandedIds,
} from '../../packages/theo/src/devtools/actions-row-state.js'

describe('actions row expand state — pure helpers', () => {
  it('toggleExpandedIds adds id when absent', () => {
    const before = new Set<string>(['a'])
    const after = toggleExpandedIds(before, 'b')
    expect(after.has('a')).toBe(true)
    expect(after.has('b')).toBe(true)
    expect(after.size).toBe(2)
  })

  it('toggleExpandedIds removes id when present (collapse)', () => {
    const before = new Set<string>(['a', 'b'])
    const after = toggleExpandedIds(before, 'b')
    expect(after.has('a')).toBe(true)
    expect(after.has('b')).toBe(false)
    expect(after.size).toBe(1)
  })

  it('toggleExpandedIds returns a NEW set (no mutation, React-safe)', () => {
    const before = new Set<string>(['a'])
    const after = toggleExpandedIds(before, 'b')
    expect(after).not.toBe(before)
    expect(before.size).toBe(1)
  })

  it('computeActionsTabIds returns sorted unique ids from records (stable rendering)', () => {
    const records = [
      { id: 'b1', name: 'x', timestamp: 2, input: {}, durationMs: 1, status: 'success' as const },
      { id: 'a1', name: 'y', timestamp: 1, input: {}, durationMs: 1, status: 'success' as const },
      { id: 'b1', name: 'z', timestamp: 3, input: {}, durationMs: 1, status: 'success' as const }, // duplicate id
    ]
    const ids = computeActionsTabIds(records)
    expect(ids).toEqual(['a1', 'b1'])
  })

  it('computeActionsTabIds handles empty input', () => {
    expect(computeActionsTabIds([])).toEqual([])
  })
})
