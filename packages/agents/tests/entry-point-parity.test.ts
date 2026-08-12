/**
 * B-102 — the two entry points are checked against each other, so a field one carries and the other
 * drops fails HERE rather than in a consumer.
 *
 * `theokit#196` is the shape this prevents: the in-process turn declared no field for `onRunEvent`
 * while the HTTP path had carried it since `#132`. No test could have caught it, and the reason is
 * worth stating — a sink nobody can install emits nothing to compare against, so the absence had no
 * observable consequence. It was found by a consumer hitting it in production, which is the
 * expensive discovery path.
 *
 * ## Why the fields are read from the source
 *
 * TypeScript interfaces do not exist at runtime, so there is nothing to introspect. Reading the
 * declarations textually is the honest alternative, and its limit is stated rather than hidden: a
 * refactor that changes how these interfaces are FORMATTED (one field per line, `readonly` prefix,
 * two-space indent) would make this stop seeing fields. The `test_both_surfaces_are_still_readable`
 * case is the canary for exactly that — without it, a formatting change would silently turn this
 * gate into a comparison of two empty sets, which passes.
 *
 * ## Why the difference list is explicit
 *
 * The two surfaces legitimately differ: an HTTP request has a working directory and a base dir; an
 * in-process call has approval plumbing the transport cannot express. Those are named below WITH
 * their reason. Anything else appearing on one side only is the defect this exists to catch, and it
 * names itself in the failure.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')

/** Field names declared on an interface, read from the source. See the docblock's stated limit. */
function fieldsOf(relativePath: string, interfaceName: string): string[] {
  const lines = readFileSync(join(SRC, relativePath), 'utf8').split('\n')
  const open = lines.findIndex(
    (l) => l.includes(`interface ${interfaceName} `) || l.includes(`type ${interfaceName} `),
  )
  if (open < 0) throw new Error(`could not find \`${interfaceName}\` in ${relativePath}`)

  // Line work rather than a regex over the whole file: the two patterns this replaces were both
  // flagged super-linear by the linter, and a declaration body is a list of lines anyway.
  const fields: string[] = []
  for (const line of lines.slice(open + 1)) {
    if (line === '}') break
    const declaration = line.trim().replace(/^readonly /, '')
    const colon = declaration.indexOf(':')
    if (colon <= 0) continue
    const name = declaration.slice(0, colon).replace(/\?$/, '')
    if (name.length > 0 && !name.includes(' ')) fields.push(name)
  }
  return fields.sort((a, b) => a.localeCompare(b))
}

/** One-sided BY DESIGN, each with the reason it cannot exist on the other surface. */
const INTENTIONALLY_ONE_SIDED: Readonly<Record<string, string>> = {
  // HTTP only — a request arrives from elsewhere and must be told where to run.
  cwd: 'an in-process caller already IS in its working directory',
  baseDir: 'same: the in-process caller resolves its own paths',
  hitl: 'the HTTP surface models approval as a request/response flag',
  // In-process only — plumbing a transport cannot carry.
  awaitApproval: 'a callback; an HTTP body cannot carry a function',
  approvals: 'an in-process approval channel, not a serialisable field',
  source: 'identifies the caller within the process',
}

describe('B-102 — the in-process and HTTP entry points carry the same fields', () => {
  const inProcess = fieldsOf('in-process-turn.ts', 'StreamAgentTurnInProcessInput')
  const http = fieldsOf('bridge/agent-endpoint.ts', 'StreamAgentOptions')

  it('test_both_surfaces_are_still_readable', () => {
    // The canary. A formatting refactor that stopped this from finding fields would turn every
    // case below into a comparison of two empty sets — which passes, silently.
    expect(inProcess.length, 'in-process fields could not be read').toBeGreaterThanOrEqual(5)
    expect(http.length, 'HTTP fields could not be read').toBeGreaterThanOrEqual(5)
  })

  it('test_no_field_is_carried_by_one_surface_and_dropped_by_the_other', () => {
    const explained = new Set(Object.keys(INTENTIONALLY_ONE_SIDED))
    const onlyInProcess = inProcess.filter((f) => !http.includes(f) && !explained.has(f))
    const onlyHttp = http.filter((f) => !inProcess.includes(f) && !explained.has(f))

    expect(
      { onlyInProcess, onlyHttp },
      'a field reaches one entry point and not the other — theokit#196 was exactly this, and it ' +
        'was found by a consumer in production because nothing here compared the two',
    ).toEqual({ onlyInProcess: [], onlyHttp: [] })
  })

  it('test_the_shared_fields_include_the_one_that_was_dropped', () => {
    // Anti-vacuity, and the regression itself: an empty difference list would satisfy the case
    // above if BOTH surfaces lost a field. `onRunEvent` is the one #196 was reopened for.
    for (const field of ['message', 'sessionId', 'images', 'signal', 'onRunEvent']) {
      expect(inProcess, `in-process lost ${field}`).toContain(field)
      expect(http, `HTTP lost ${field}`).toContain(field)
    }
  })

  it('test_every_declared_exception_is_still_one_sided', () => {
    // The list rots the other way too: an exception for a field that now exists on BOTH surfaces
    // reads as a considered decision while excusing nothing, and it would hide a real divergence
    // if that field later disappeared from one side.
    const stale = Object.keys(INTENTIONALLY_ONE_SIDED).filter(
      (f) => inProcess.includes(f) && http.includes(f),
    )

    expect(stale, 'these are on both surfaces and no longer need an exception').toEqual([])
  })
})
