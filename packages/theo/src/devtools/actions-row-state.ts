/**
 * Pure state helpers for ActionsTab row-level expand/collapse.
 *
 * Mirrors RequestsTab UX: each row is a click-to-toggle button. State
 * lives in a single `Set<string>` of expanded ids — naturally React-safe
 * via clone-on-toggle and unmount-clean.
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */

import type { ActionCallRecord } from './shared.js'

/**
 * Toggle `id` membership in the expanded set. Returns a NEW Set (never
 * mutates the input) so React reference-equality detects the change.
 */
export function toggleExpandedIds(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

/**
 * Dedupe + sort ids from action records. Sorted order keeps row keys
 * stable across re-renders (otherwise React would tear down + remount
 * expanded rows when records re-arrive out of order).
 */
export function computeActionsTabIds(records: readonly ActionCallRecord[]): string[] {
  const seen = new Set<string>()
  for (const r of records) seen.add(r.id)
  return [...seen].sort((a, b) => a.localeCompare(b))
}
