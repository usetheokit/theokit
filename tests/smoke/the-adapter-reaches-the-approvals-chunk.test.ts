/**
 * The deploy adapter's entry reaches the approvals handler (T1.4 of B-185).
 *
 * The item's third DoD asks that the reachability be a TEST rather than a session's measurement:
 * chunk names are content-hashed, so a text search for "approvals" in `agent-mount.js` finds
 * nothing whether or not the code is reachable through an import chain. Only a walk decides it.
 *
 * WHY A BOOLEAN OVER ONE NAMED ENTRY, and not a count. An earlier draft asserted ">= 5 reaching
 * entries against the 4 measured today", and two reviewers walking the same graph showed it
 * discriminates under no counting method: top-level `dist/*.js` gives 4 both before and after,
 * because `adapters/agent-mount.js` sits at depth 2 and is ineligible; a recursive walk gives 5
 * both before and after. Three readers produced 12, 13 and 16 for the module count of this very
 * entry, differing on whether the entry itself counts and whether dynamic `import()` is followed —
 * while agreeing on the only thing that matters, which is whether the symbol is reached at all.
 *
 * So the assertion is the property with no definitional freedom: does THIS entry's graph contain
 * the symbol. Measured before the fix — 12 modules reached by static `from`, 15 with dynamic
 * imports, and `handleListApprovals` in none of them. After — 18, and one of them has it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ENTRY = resolve('packages/theo/dist/adapters/agent-mount.js')

/** Every module the entry reaches through static `from '...'` specifiers, transitively. */
function reachableFrom(entry: string): string[] {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop()
    if (file === undefined || seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    const text = readFileSync(file, 'utf-8')
    for (const match of text.matchAll(/from\s*["'](\.\.?\/[^"']+)["']/g)) {
      stack.push(resolve(dirname(file), match[1]))
    }
  }
  seen.delete(entry)
  return [...seen]
}

describe('the deploy adapter reaches the approvals handler (B-185)', () => {
  it('test_the_entry_every_adapter_calls_reaches_handle_list_approvals', () => {
    // A missing dist is a failure, not a skip: this test exists to gate a BUILD, and a gate that
    // passes when there is nothing to inspect is the vacuous-guard defect B-185 met twice in its
    // own tooling.
    expect(
      existsSync(ENTRY),
      'packages/theo/dist is not built — run `npx tsup` in packages/theo. This test reads the ' +
        'emitted graph, so an unbuilt dist means the property was not checked, not that it holds',
    ).toBe(true)

    const reached = reachableFrom(ENTRY)
    const carriers = reached.filter((f) => readFileSync(f, 'utf-8').includes('handleListApprovals'))

    expect(
      carriers.length,
      `agent-mount.js is what every deploy adapter calls, and it reached ${String(reached.length)} ` +
        `modules with the approvals handler in none of them — which is the defect B-185 measured. ` +
        `A build that drops it from this graph ships a deploy target whose approvals endpoint ` +
        `falls through to the run handler again.`,
    ).toBeGreaterThan(0)
  })

  it('test_the_probe_resolves_so_an_absence_would_be_real', () => {
    // The inverse of the assertion above, and the reason it is worth anything: a walk that reaches
    // nothing would report "not found" for a symbol that is there. `mountAgent` is the control —
    // the entry's own reason for existing, so it must be reachable by construction.
    const reached = reachableFrom(ENTRY)
    expect(reached.length).toBeGreaterThan(5)
    expect(
      reached.some((f) => readFileSync(f, 'utf-8').includes('mountAgent')),
      'the walk did not reach mountAgent, which agent-mount.js exports — so the probe is broken ' +
        'and an absence it reports says nothing about the graph',
    ).toBe(true)
  })
})
