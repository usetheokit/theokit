/**
 * M73 — "enriching never reduces": the layer re-exports the SDK's store mechanics.
 *
 * ## Why this file exists
 *
 * `@theokit/sdk/auth` exports 19 symbols; `@theokit/agents/auth` exported **1 value and 6 types** —
 * `AuthProvider` plus the domain types. **Zero functions crossed.**
 *
 * This is not a convenience detail. The consumer (`agent-builder`) holds an UNBREAKABLE rule never
 * to import `@theokit/sdk*` directly: every SDK surface must arrive through this layer. Without the
 * re-export, **reimplementing was the only legal way out** — and that is what happened: six identical
 * names
 * (`credentialHome`, `authFilePath`, `CredentialError`, `readStoredOAuth`, `resolveCredential`,
 * `writeCredential`) rewritten over there, ~120 lines of duplicated store mechanics.
 *
 * The defect was not the consumer's indiscipline. It was a gap here that left only one door open.
 *
 * ## Why a PURE pass-through, and not a wrapper
 *
 * The layer exists to ENRICH (parsimony Rung 9): it adds OO where there is state or orchestration to
 * hold — which is what `AuthProvider` does with the `config`+`store` pair. The store mechanics are
 * pure I/O functions: wrapping them would only add a layer of indirection with nothing inside.
 *
 * ## What this test protects that nobody would see break
 *
 * `instanceof`. The consumer writes `err instanceof CredentialError` on the login path. While the
 * class is **the same reference** as the SDK's, that works. If the build ever inlines the SDK
 * (`noExternal` in tsup), the layer starts exporting a **copy** of the class: `instanceof` silently
 * becomes `false`, the typed error stops being recognized, and **no behavioural test goes red**. That
 * is why the assertion is one of referential identity (`toBe`), not of shape.
 */
import { describe, expect, it } from 'vitest'

import * as layerDir from '../../src/auth-entry.js'
import * as sdk from '@theokit/sdk/auth'

/** The store mechanics — what the SDK owns and what the layer must let cross. */
const MECANICA_DE_STORE = [
  'credentialHome',
  'authFilePath',
  'CredentialError',
  'readAuthFile',
  'readStoredOAuth',
  'writeCredential',
] as const

/**
 * M110 — the **RFC 8628** device flow, on the SAME argument as M73, over symbols it did not cover.
 *
 * Measured before re-exporting: the SDK implements the standard and this subpath re-exported **only**
 * OpenAI's variant. A consumer needing the RFC had two ways out — break the UNBREAKABLE boundary, or
 * reimplement the protocol. The second is legal, and it is exactly the class of defect M73 documents
 * as having cost ~120 duplicated lines in another subsystem.
 *
 * These join the SAME `toBe` battery on purpose: a pure pass-through has one oracle, and it is
 * referential identity. A separate list with a weaker assertion would be a second oracle over the
 * same fact.
 */
const STANDARD_DEVICE_FLOW = [
  'deviceLogin',
  'requestDeviceCode',
  'pollDeviceToken',
  // `openaiDeviceLogin` belongs HERE, and M110's review measured why that matters: wrapping it passed
  // the whole battery (21/21, EXIT=0). It was checked only by `toBeDefined` and by
  // `not.toBe(deviceLogin)` — neither of which sees a wrapper.
  //
  // It was the symbol the milestone exists to make reachable, and the only one without the strong pin.
  'openaiDeviceLogin',
] as const

/**
 * M112 — the OAuth ENGINE (exchange / refresh / persist), by the SAME argument as M73 and M110, over
 * the subsystem neither of them covered.
 *
 * Measured in the TheoCode ↔ theokit cross-validation of 2026-08-07: `@theokit/sdk/auth` exports
 * `ensureFreshCredential`, `persistOAuthTokens`, `refreshOAuthTokens` and `extractAccountId`; this
 * subpath re-exported NONE of the four. The consumer, which cannot import `@theokit/sdk*` directly,
 * did the only legal thing left — it rewrote the mechanics by hand (TheoCode's
 * `packages/agent/src/auth/credentials.ts`, finding SAC-07).
 *
 * This is the third re-enactment of the SAME M73 sentence: *"the gap was ours, not their
 * indiscipline"*. The pattern already cost ~120 duplicated lines in M73 and the whole RFC protocol
 * in M110.
 *
 * `extractAccountId` comes along because it is the natural pair of refresh: whoever persists tokens
 * needs to know which account they belong to, and the alternative is the consumer decoding the JWT
 * on its own.
 */
const OAUTH_ENGINE = [
  'ensureFreshCredential',
  'persistOAuthTokens',
  'refreshOAuthTokens',
  'extractAccountId',
] as const

const PASS_THROUGH = [...MECANICA_DE_STORE, ...STANDARD_DEVICE_FLOW, ...OAUTH_ENGINE] as const

describe('M112 — `resolveCredential` still does NOT cross over, on purpose', () => {
  it('test_resolveCredential_does_not_cross_the_layer', () => {
    // The deliberate exception `auth-entry.ts` has documented since M73: the SDK and the consumer
    // have DIFFERENT functions under that name (sync vs async, throws vs `undefined`, reads env vs
    // does not, infers provider vs refuses), and the SDK itself declares that env precedence, prefix
    // inference and the declared provider are the consumer's **app policy**.
    //
    // This test exists because M112 opens the neighbouring subsystem: without an explicit lock, the
    // next milestone that "completes the auth pass-through" adds it out of symmetry, and the consumer
    // ends up with two identical names of divergent semantics in one scope — a silent failure, which
    // is exactly what the original decision avoids.
    expect(
      (layerDir as Record<string, unknown>).resolveCredential,
      '`resolveCredential` started crossing the layerDir. The omission is DELIBERATE and documented in ' +
        '`src/auth-entry.ts`: two functions share this name with divergent semantics. Exposing both ' +
        'in one scope invites importing the wrong one, silently.',
    ).toBeUndefined()
  })
})

describe('M110 — the layerDir does NOT hide the standard device flow behind the OpenAI variant', () => {
  it('test_the_OPENAI_variant_still_crosses', () => {
    // ANTI-VACUITY FLOOR: if neither crossed, "the standard crosses" would be satisfied by an empty
    // subpath. And Codex is the provider this work exists to make easier — losing it while opening the
    // standard would invert the result.
    expect(
      layerDir.openaiDeviceLogin,
      "OpenAI's variant stopped crossing — Codex became unreachable",
    ).toBeDefined()
  })

  it('test_BOTH_shapes_coexist_and_are_DISTINCT', () => {
    // Merging the two protocols would break Codex: the RFC has ONE `deviceCodeEndpoint`; OpenAI has
    // TWO (`deviceUsercodeEndpoint` → `devicePollEndpoint`, with PKCE). This test fails if somebody
    // "simplifies" by pointing both names at the same function.
    expect(
      layerDir.deviceLogin,
      "the standard flow and OpenAI's became the same reference — the protocols differ, and " +
        'unifying them breaks Codex',
    ).not.toBe(layerDir.openaiDeviceLogin)
  })
})

describe('M73 — @theokit/agents/auth lets the store mechanics cross', () => {
  it.each(PASS_THROUGH)('test_the_layer_re_exports_%s_from_the_sdk', (name) => {
    expect(
      (layerDir as Record<string, unknown>)[name],
      `\`${name}\` does not cross the layer. The consumer cannot import \`@theokit/sdk*\` directly ` +
        '(an UNBREAKABLE boundary), so without this re-export its only legal way out is to ' +
        'reimplement — which is exactly how six identical names ended up in agent-builder.',
    ).toBeDefined()
  })

  it.each(PASS_THROUGH)('test_%s_is_the_SAME_reference_as_the_sdk', (name) => {
    // `toBe`, not `toBeDefined`: a PURE pass-through. A wrapper would pass the previous test and fail
    // here — and it is the wrapper that breaks `instanceof` with nothing going red.
    expect(
      (layerDir as Record<string, unknown>)[name],
      `\`${name}\` exists in the layer but is NOT the same reference as the SDK's. Either it became a ` +
        'wrapper, or the build inlined the SDK. For a CLASS that silently breaks `instanceof` in the ' +
        'consumer; for a function, it makes the layer diverge from what the SDK guarantees.',
    ).toBe((sdk as Record<string, unknown>)[name])
  })

  it('test_CredentialError_preserves_instanceof_across_the_layer', () => {
    // The concrete case: the consumer's `agents/lib/auth/login.ts:48` does
    // `err instanceof CredentialError` with the class imported FROM HERE, against an error thrown by
    // the SDK. It only works with a single realm.
    const thrownBySdk = new sdk.CredentialError('a test error')
    expect(
      thrownBySdk instanceof layerDir.CredentialError,
      'the class the layer exports does not recognize an error thrown by the SDK — there are two ' +
        "realms, and the consumer's `instanceof` fails silently",
    ).toBe(true)
  })
})
