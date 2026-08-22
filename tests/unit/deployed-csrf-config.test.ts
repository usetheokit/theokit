/**
 * The configured CSRF mode must survive the trip to a deployed target
 * (usetheokit/theokit#410).
 *
 * The six Web-standards adapter entries built `executeRoute`'s context from an eight-field
 * literal, and `csrfMode` was not one of the eight. `executeRoute` defaults it to `'strict'`
 * (`server/http/execute.ts`), so an app declaring `security: { csrf: 'off' }` got `'strict'` on
 * every deploy target: a POST that works under `theokit dev` and `theokit start` answers
 * `403 CSRF_INVALID` on Vercel, naming a mechanism the operator had turned off. The config still
 * validated, the build still succeeded, and nothing warned.
 *
 * `disallowed` travelled with it, and carries the sharper hazard: its `routes` may hold RegExp
 * entries, which `JSON.stringify` turns into `{}` — an escalation rule that silently matches
 * nothing. A literal renderer that reached for JSON would reproduce this issue's own defect one
 * layer down, so the emitted form is evaluated here rather than pattern-matched.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { renderDeployedCsrfLiteral } from '../../packages/theo/src/adapters/deployed-csrf.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Evaluate the emitted literal the way the deployed entry will: as module source.
 *
 * Importing a written file rather than `eval`-ing a string is the same instrument the adapters'
 * own parse gate uses, and it fails on emitted source that is merely *plausible* — a missing
 * comma or an unescaped quote is a syntax error here, not a passing string comparison.
 */
async function evaluated(literal: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'theo-csrf-literal-'))
  dirs.push(dir)
  const file = join(dir, 'literal.mjs')
  writeFileSync(file, `export default ${literal}\n`, 'utf8')
  const mod = (await import(pathToFileURL(file).href)) as { default: Record<string, unknown> }
  return mod.default
}

describe('the deployed entry carries the configured CSRF mode (#410)', () => {
  it("emits the declared mode, so 'off' does not deploy as 'strict'", async () => {
    const value = await evaluated(renderDeployedCsrfLiteral({ csrf: 'off' }))

    expect(value.csrfMode).toBe('off')
  })

  it('emits nothing to override when the app declared no security block', async () => {
    // `executeRoute` defaults an absent `csrfMode` to 'strict', and so does the schema when the
    // block exists. Both paths agreeing is the property; emitting an explicit 'strict' would be
    // a second place for that default to drift.
    const value = await evaluated(renderDeployedCsrfLiteral(undefined))

    expect(value.csrfMode).toBeUndefined()
    expect(value.disallowed).toBeUndefined()
  })

  it('keeps a RegExp escalation rule as a RegExp, not as {}', async () => {
    const value = await evaluated(
      renderDeployedCsrfLiteral({
        csrf: 'warn',
        disallowed: { routes: ['/api/exact', /^\/api\/admin\//u], behavior: 'raise' },
      }),
    )

    const disallowed = value.disallowed as { routes: unknown[]; behavior: string }
    expect(disallowed.behavior).toBe('raise')
    expect(disallowed.routes[0]).toBe('/api/exact')
    expect(disallowed.routes[1]).toBeInstanceOf(RegExp)
    // The property that matters is that it still MATCHES. A `{}` would be truthy and match
    // nothing, which is an escalation rule that reports as configured and never fires.
    expect((disallowed.routes[1] as RegExp).test('/api/admin/users')).toBe(true)
  })

  it('escapes a string route that would otherwise close the literal', async () => {
    const value = await evaluated(
      renderDeployedCsrfLiteral({
        csrf: 'strict',
        disallowed: { routes: ["/api/o'brien"], behavior: 'warn' },
      }),
    )

    expect((value.disallowed as { routes: string[] }).routes[0]).toBe("/api/o'brien")
  })
})
