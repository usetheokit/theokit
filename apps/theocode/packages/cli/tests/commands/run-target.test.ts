/**
 * B-141 — the credential-routing ORDER, which the source calls "the fix", had no test.
 *
 * `run.ts` states it plainly: route the model id for the credential that will serve it, THEN resolve
 * a credential for the routed id, THEN build on that same id. Getting it wrong is not theoretical —
 * it shipped, and it was measured on 2026-08-25: with a ChatGPT sign-in the configured id is
 * `openai/…`, which selects the API-key provider, and `api.openai.com` refuses an OAuth token
 * (`401 Missing scopes: api.responses.write`). One credential worked in the TUI and failed in the
 * CLI, on a product whose README calls itself "one agent core, two surfaces" — and after the
 * transport's retries the failure surfaced as `rate_limit (HTTP 429)`, sending the user to check a
 * quota page for an auth problem.
 *
 * Nothing tested it. `grep -rl routeToCredential packages | grep test` returned nothing. The order
 * survived only as a comment, on a path where a previous version of the same code cost a user their
 * turn and their diagnosis.
 *
 * Found 2026-09-03 while checking whether extracting `resolveRunTarget` had changed behaviour. It
 * had not — the sequence is byte-identical to `333cb7e` — but a refactor over an untested
 * guarantee is a coin-flip that happened to land right.
 */
import { describe, expect, it } from 'vitest'

import { resolveRunTarget } from '../../src/commands/run.js'

const args = { model: 'openai/gpt-5.6-terra' } as never

/**
 * The half of a `RunComposition` these cases do not vary.
 *
 * `cfg` is here because #29 made the composition's `shell_timeout_ms` reach the diff runner: the
 * stub used to omit it, and `resolveRunTarget` now reads it. The value is the shape, not a
 * decision — every case below is about the ORDER of the two credential resolutions.
 */
const COMPOSED = { cfg: { shell_timeout_ms: 10_000 }, policy: 'p', mod: 'm' }

describe('resolveRunTarget', () => {
  it('test_the_probe_resolves_before_the_route_is_decided', async () => {
    // `routeToCredential` cannot decide without knowing whether the credential is an OAuth one, and
    // that answer only comes from resolving. A route computed before the probe is a guess.
    const order: string[] = []

    await resolveRunTarget(args, {
      resolveCredentialForModel: async (model: string | undefined) => {
        order.push(`resolve:${model ?? '(undefined)'}`)
        return { apiKey: 'k', kind: 'oauth', provider: 'openai' } as never
      },
      routeToCredential: (_cred, id) => {
        order.push(`route:${id}`)
        return `openai-chatgpt/${id}`
      },
      composeRun: ((o: { routeModel: (id: string) => string }) =>
        ({ ...COMPOSED, model: o.routeModel('gpt-5.6-terra') }) as never) as never,
    })

    expect(order[0]).toBe('resolve:openai/gpt-5.6-terra')
    expect(order[1]).toBe('route:gpt-5.6-terra')
  })

  it('test_the_second_resolution_uses_the_ROUTED_id_not_the_configured_one', async () => {
    // This is the bug, exactly. Resolving on the configured id selects the API-key provider for an
    // OAuth credential, and `api.openai.com` refuses it with a 401 that reaches the user as a 429.
    const resolvedWith: string[] = []

    await resolveRunTarget(args, {
      resolveCredentialForModel: async (model: string | undefined) => {
        resolvedWith.push(model ?? '(undefined)')
        return { apiKey: 'k', kind: 'oauth', provider: 'openai' } as never
      },
      routeToCredential: (_cred, id) => `openai-chatgpt/${id}`,
      composeRun: ((o: { routeModel: (id: string) => string }) =>
        ({ ...COMPOSED, model: o.routeModel('gpt-5.6-terra') }) as never) as never,
    })

    expect(resolvedWith).toHaveLength(2)
    expect(resolvedWith[0], 'the probe must use the CONFIGURED id').toBe('openai/gpt-5.6-terra')
    expect(
      resolvedWith[1],
      'the second resolution used the configured id — this is the 401-as-429 bug',
    ).toBe('openai-chatgpt/gpt-5.6-terra')
  })

  it('test_the_route_is_offered_the_probe_rather_than_a_fresh_resolution', async () => {
    // Anti-vacuity for the two above: `routeToCredential` must receive the credential the probe
    // produced. Handing it anything else reintroduces the ordering problem behind a passing test.
    const probe = { apiKey: 'k', kind: 'oauth', provider: 'openai' }
    let sawCredential: unknown

    await resolveRunTarget(args, {
      resolveCredentialForModel: async () => probe as never,
      routeToCredential: (cred, id) => {
        sawCredential = cred
        return id
      },
      composeRun: ((o: { routeModel: (id: string) => string }) =>
        ({ ...COMPOSED, model: o.routeModel('x') }) as never) as never,
    })

    expect(sawCredential).toBe(probe)
  })

  it('test_it_returns_the_key_from_the_second_resolution', async () => {
    let call = 0
    const target = await resolveRunTarget(args, {
      resolveCredentialForModel: async () => {
        call += 1
        return { apiKey: call === 1 ? 'probe-key' : 'routed-key' } as never
      },
      routeToCredential: (_c, id) => id,
      composeRun: ((o: { routeModel: (id: string) => string }) =>
        ({ ...COMPOSED, model: o.routeModel('x') }) as never) as never,
    })

    // The probe's key is a by-product; the turn must run on the credential resolved for the id it
    // will actually use.
    expect(target.apiKey).toBe('routed-key')
  })
})
