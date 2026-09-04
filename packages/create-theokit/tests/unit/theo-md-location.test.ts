import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Where `THEO.md` lives, and why the answer is tied to a version this template declares.
 *
 * `usetheokit/theokit#642` asked whether the scaffold should keep two context files once the SDK
 * could read a root `THEO.md`. It can, since `@theokit/sdk@5.0.0-next.3` — but only on `next`, and
 * this template pins a 4.x range, where a root copy is read by **nothing, silently**.
 *
 * So the file stays under `.theokit/`, and `THEO.md` explains that in terms of the range. This test
 * ties the two together: move the pin past 4.x and the explanation stops matching the manifest, so
 * the prose has to be revisited rather than quietly becoming wrong — which is the failure mode the
 * whole issue was filed about.
 */
const TEMPLATE = join(import.meta.dirname, '../../templates/default')
const read = (rel: string): string => readFileSync(join(TEMPLATE, rel), 'utf-8')

describe('the THEO.md location decision (#642)', () => {
  it('stays under .theokit/, which is the only path a 4.x SDK reads', () => {
    expect(read('dot-theokit/THEO.md')).toContain('# Product context')
    // A root copy would be inert on the pinned SDK, so shipping one would teach the wrong location.
    expect(() => read('THEO.md')).toThrow()
  })

  it('the explanation cites the range the template actually declares', () => {
    const pinned = JSON.parse(read('package.json.tmpl')).dependencies['@theokit/sdk'] as string
    // Not a literal in the test: the point is that the two agree. If the pin moves, this fails and
    // the prose gets re-read — the alternative is an explanation that outlives its own premise.
    expect(read('dot-theokit/THEO.md')).toContain(pinned)
  })

  it('names the version that changed the answer, so the note expires on a fact', () => {
    const theo = read('dot-theokit/THEO.md')
    expect(theo).toContain('@theokit/sdk@5')
    expect(theo).toContain('next')
  })

  it('keeps the pair, and says the reason is audience rather than the SDK', () => {
    // The two-file split predates the SDK limitation and outlives it: AGENTS.md addresses agents
    // that WRITE the code (and is read by other tools), THEO.md the agent that talks to users.
    // Recording that here means a future reader cannot mistake the pair for a leftover workaround.
    const theo = read('dot-theokit/THEO.md')
    expect(theo).toContain('AGENTS.md')
    expect(theo.toLowerCase()).toContain('audience')
  })
})
