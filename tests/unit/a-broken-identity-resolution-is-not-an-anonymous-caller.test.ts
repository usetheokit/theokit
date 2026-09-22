import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createAgentSubjectResolver,
  createSubjectResolverFromFactory,
} from '../../packages/theo/src/server/http/resolve-agent-subject.js'

/**
 * SI-013, reopened by the surface-closure inventory judge after it was blocked with the reason
 * "exercising this needs a running target". That conflated two halves, and the judge was right:
 * only the 500 STATUS needs an emitted entry. The promise itself —
 *
 *   "A `createContext` that throws is not swallowed — an application whose identity resolution is
 *    broken must not be treated as an anonymous caller, because that reads as a clean refusal and
 *    hides the fault."  (resolve-agent-subject.ts:69-72)
 *
 * — is a property of this function and needs nothing standing up. Blocking it was a fix being
 * avoided by reclassification.
 */
describe('a broken identity resolution is not an anonymous caller', () => {
  const BOOM = new Error('the app could not decide who is asking')

  it('test_a_throwing_context_factory_rejects_rather_than_resolving_null', async () => {
    const resolve = createSubjectResolverFromFactory(
      () => {
        throw BOOM
      },
      {},
      {},
    )
    // `null` is the documented value for "nobody is authenticated", so resolving it here would make
    // a broken app indistinguishable from an anonymous visitor — and `agent-access.ts` would then
    // issue a clean policy refusal for what is a server fault.
    await expect(resolve()).rejects.toThrow(BOOM)
  })

  it('test_a_rejecting_context_factory_propagates_its_reason', async () => {
    const resolve = createSubjectResolverFromFactory(() => Promise.reject(BOOM), {}, {})
    await expect(resolve()).rejects.toThrow(BOOM)
  })

  it('test_the_control_a_factory_that_returns_nothing_DOES_resolve_null', async () => {
    // The control that makes the two above mean something. An app with no `createContext` resolves
    // an anonymous caller, which is the honest answer rather than an invented subject — so a test
    // that merely showed "rejects" without this would not distinguish the two paths at all.
    const resolve = createSubjectResolverFromFactory(undefined, {}, {})
    await expect(resolve()).resolves.toBeNull()
  })

  it('test_the_filesystem_mechanism_makes_the_same_promise', async () => {
    // ADR 0014 decides TWO mechanisms, and a guarantee that held on only one of them would be the
    // gap SI-017 exists to refuse.
    //
    // The context file must EXIST: `middleware-runner.ts:221` returns `{}` when it does not, and
    // that is the documented anonymous case rather than a swallowed fault. A first version of this
    // test pointed at `/nowhere` and read the resulting `null` as a missing guarantee — it was
    // measuring the absent-module branch, not the throwing-factory one.
    const dir = mkdtempSync(join(tmpdir(), 'theo-ctx-'))
    try {
      writeFileSync(join(dir, 'context.ts'), '// present so the loader is reached\n')
      const resolve = createAgentSubjectResolver({
        req: {},
        res: {},
        loadModule: () =>
          Promise.resolve({
            createContext: () => {
              throw BOOM
            },
          }),
        serverDir: dir,
        pluginRunner: undefined,
      } as unknown as Parameters<typeof createAgentSubjectResolver>[0])
      await expect(resolve()).rejects.toThrow(BOOM)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('test_the_filesystem_mechanism_still_resolves_null_when_there_is_no_context_file', async () => {
    // The control for the case above: absent module and broken module must not produce the same
    // answer, which is the whole content of the promise being tested.
    const dir = mkdtempSync(join(tmpdir(), 'theo-noctx-'))
    try {
      const resolve = createAgentSubjectResolver({
        req: {},
        res: {},
        loadModule: () => Promise.reject(new Error('the loader must not be reached')),
        serverDir: dir,
        pluginRunner: undefined,
      } as unknown as Parameters<typeof createAgentSubjectResolver>[0])
      await expect(resolve()).resolves.toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
