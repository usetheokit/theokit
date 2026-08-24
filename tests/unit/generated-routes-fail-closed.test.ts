/**
 * A generated CRUD resource must fail CLOSED (usetheokit/theokit#416).
 *
 * ADR 0001 made an undeclared `policy` a build error on the reasoning that "a route that nobody
 * had thought about was indistinguishable from a route deliberately left open". The generator then
 * wrote `'public'` on five methods that read and write a database table — so the generated file
 * WAS the not-thought-about case wearing the deliberate value, which is the exact state the gate
 * exists to make impossible. `theo build` accepted it, because
 * `assertEveryMethodDeclaresPolicy` asks whether a policy was declared, not which.
 *
 * The refusal is emitted as an `AccessDecision` object rather than the `() => false` the report
 * suggests, because `evaluateRoutePolicy` maps a bare `false` to the generic "access denied by
 * route policy". The report's own Expected asks for "a message naming the file to edit", and the
 * contract already carries one: "A denial carries its reason so the caller can say it."
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateCommand } from '../../packages/theo/src/cli/commands/generate.js'
import {
  evaluateRoutePolicy,
  type RoutePolicy,
} from '../../packages/theo/src/core/contracts/route-policy.js'

function createTempProject(): string {
  // `mkdtempSync`, not a name built from pid and a clock: this directory is WRITTEN to, and a
  // name another process can predict is a window to pre-create it as a symlink and take every
  // write with it (CodeQL `js/insecure-temporary-file`).
  const dir = mkdtempSync(join(tmpdir(), 'theo-policy-gen-'))
  mkdirSync(join(dir, 'server/routes'), { recursive: true })
  mkdirSync(join(dir, 'server/actions'), { recursive: true })
  mkdirSync(join(dir, 'app'), { recursive: true })
  mkdirSync(join(dir, 'server/db'), { recursive: true })
  // `generateResource` appends the table to this file and refuses without it.
  writeFileSync(join(dir, 'server/db/schema.ts'), '// generated tables append here\n')
  writeFileSync(join(dir, 'theo.config.ts'), 'export default {}')
  writeFileSync(join(dir, 'package.json'), '{}')
  return dir
}

async function generated(kind: string, name: string, files: string[]): Promise<string[]> {
  const dir = createTempProject()
  const orig = process.cwd()
  process.chdir(dir)
  try {
    await generateCommand(kind, name, kind === 'resource' ? ['title:string'] : undefined)
    return files.map((f) => readFileSync(join(dir, f), 'utf8'))
  } finally {
    process.chdir(orig)
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('generated routes fail closed (#416)', () => {
  it('a generated CRUD resource declares no public method', async () => {
    const sources = await generated('resource', 'posts', [
      'server/routes/posts/index.ts',
      'server/routes/posts/[id].ts',
    ])

    for (const src of sources) {
      // Five DB-backed methods across the two files. `'public'` on any of them is an
      // unauthenticated, world-writable table that every check in the project reports as
      // compliant.
      expect(src).not.toContain(`.policy('public')`)
    }
  })

  it("the refusal names the file to edit, so 'I forgot' surfaces on the first curl", async () => {
    const [index, byId] = await generated('resource', 'posts', [
      'server/routes/posts/index.ts',
      'server/routes/posts/[id].ts',
    ])

    expect(index).toContain('server/routes/posts/index.ts')
    expect(byId).toContain('server/routes/posts/[id].ts')
  })

  it('a generated plain route is not public either', async () => {
    const [src] = await generated('route', 'users', ['server/routes/users.ts'])

    expect(src).not.toContain(`.policy('public')`)
    expect(src).toContain('server/routes/users.ts')
  })

  it('the emitted denial shape actually denies, with its own reason', async () => {
    // The link between "what the generator writes" and "what happens on a request": the shape
    // above is evaluated by the framework's single policy evaluator. A bare `false` would reach
    // the caller as the generic 'access denied by route policy', which is why the generator emits
    // the object form.
    const emitted = (): { allowed: false; reason: string } => ({
      allowed: false,
      reason: 'edit server/routes/posts/index.ts',
    })

    const decision = await evaluateRoutePolicy(emitted, {
      subject: null,
      query: {},
      body: {},
      params: {},
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error('the placeholder policy allowed the request')
    expect(decision.reason).toContain('server/routes/posts/index.ts')
  })

  it('the emitted shape is assignable to RoutePolicy, so a generated app compiles', () => {
    // The generated const takes no argument and is annotated `(): AccessDecision`. Both facts
    // have to hold against the real type or `theo generate` produces a project that does not
    // typecheck — which is the one failure mode that would make failing closed worse than the
    // 'public' it replaces.
    const emitted: RoutePolicy = (): { allowed: false; reason: string } => ({
      allowed: false,
      reason: 'server/routes/posts/index.ts still carries the policy the generator wrote',
    })

    expect(typeof emitted).toBe('function')
  })
})
