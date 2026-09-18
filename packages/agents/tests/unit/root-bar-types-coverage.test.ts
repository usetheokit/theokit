import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

import { beforeAll, describe, expect, it } from 'vitest'

import { exportedSymbols } from '../../scripts/capability-map.mjs'

/**
 * The coverage policy reaches the half of the root bar `Object.keys` cannot see.
 *
 * ## The hole this closes
 *
 * `root-bar-coverage.test.ts` demands an `in`/`out` verdict for every root-bar VALUE, and says in its
 * own header that its enumeration is `Object.keys` over the imported namespace — the runtime object,
 * where every `export type` has already been erased. It names that a known gap rather than papering
 * over it (`docs/adr/0005`), and the declaration carried no number.
 *
 * Measured here 2026-09-18 with the compiler instead: the SDK root bar is **99 values and 323 types**,
 * 422 in total. So three quarters of it was outside what any gate could see. The cross-validation
 * audit put the type share at 324; the one-symbol difference is the version skew it declared
 * (baseline 5.8.0, installed 5.9.0).
 *
 * ## Why the verdict is demanded of the 38 that CROSS, and not of all 323
 *
 * A verdict exists to stop "nobody decided" from reading like "we decided it stays out". For a type
 * that does NOT cross, the consumer reaches it from `@theokit/sdk` directly, and the question a
 * consumer actually hits — *is there a type I need and cannot name?* — is already derived, not
 * listed, by `every-public-type-crosses-the-barrel.test.ts`.
 *
 * What has no decision anywhere is the opposite direction: a type that DOES cross widens this
 * package's boundary, and 14 of the 38 arrive through an `export *` in the root barrel without being
 * named there at all. Nobody wrote those; a star did. That is the state this policy exists to end,
 * and 285 hand-written `out` lines would have bought none of it.
 *
 * ## The oracle is the compiler, and it disagrees with the runtime on purpose
 *
 * `root-bar-coverage.test.ts` uses `Object.keys` deliberately — its header records that the `.d.ts`
 * carries `createTokenLimiter` from 5.3.0 while the module does not export it until 5.8.0. That
 * argument is about VALUES, where the runtime is the thing a consumer calls. A type has no runtime,
 * so the declaration is the only oracle there is.
 */

const require_ = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..', '..')

interface Inside {
  readonly verdict: 'in'
  /** How it crosses — the honest two states, and the second is the finding. */
  readonly via: 'named in src/index.ts' | 'star re-export, named nowhere in src/index.ts'
}

interface Outside {
  readonly verdict: 'out'
  readonly reason: string
}

type Verdict = Inside | Outside

/**
 * Every SDK root-bar TYPE that crosses into this package.
 *
 * A type that starts crossing and is not here breaks `test_every_CROSSING_root_bar_type_has_a_verdict`
 * once, and the fix is a line stating the decision. The `via` values were measured, not assigned:
 * 24 are named in `src/index.ts` and 14 arrive through one of its six `export *` lines.
 */
const NAMED = 'named in src/index.ts' as const
const STAR = 'star re-export, named nowhere in src/index.ts' as const

const TYPE_VERDICTS: Record<string, Verdict> = {
  AgentDefinition: { verdict: 'in', via: NAMED },
  AgentOptions: { verdict: 'in', via: NAMED },
  BudgetOptions: { verdict: 'in', via: NAMED },
  BudgetTracker: { verdict: 'in', via: NAMED },
  CustomTool: { verdict: 'in', via: NAMED },
  DiagnosticsSink: { verdict: 'in', via: NAMED },
  InlineSkill: { verdict: 'in', via: NAMED },
  McpAuthConfig: { verdict: 'in', via: NAMED },
  McpHttpServerConfig: { verdict: 'in', via: NAMED },
  McpOAuthConfig: { verdict: 'in', via: NAMED },
  McpServerConfig: { verdict: 'in', via: NAMED },
  McpStdioServerConfig: { verdict: 'in', via: NAMED },
  PluginsSettings: { verdict: 'in', via: NAMED },
  ProviderRoutingSettings: { verdict: 'in', via: NAMED },
  RunEvent: { verdict: 'in', via: NAMED },
  SDKAgent: { verdict: 'in', via: NAMED },
  SessionRecord: { verdict: 'in', via: NAMED },
  SessionStore: { verdict: 'in', via: NAMED },
  ToolResultContentBlock: { verdict: 'in', via: NAMED },
  TrustLevel: { verdict: 'in', via: NAMED },
  TrustPosture: { verdict: 'in', via: NAMED },
  TrustPostureInput: { verdict: 'in', via: NAMED },
  TrustSource: { verdict: 'in', via: NAMED },
  WiredEntity: { verdict: 'in', via: NAMED },

  // ── The fourteen a star brought. Each is `in` because it demonstrably crosses; the `via` records
  // that nobody wrote it, which is the difference between a decision and an accident.
  AgentRunErrorCode: { verdict: 'in', via: STAR },
  ApprovalMode: { verdict: 'in', via: STAR },
  CompatSurface: { verdict: 'in', via: STAR },
  ErrorCode: { verdict: 'in', via: STAR },
  ErrorMetadata: { verdict: 'in', via: STAR },
  GoalEvent: { verdict: 'in', via: STAR },
  GoalLoopAgent: { verdict: 'in', via: STAR },
  GoalOptions: { verdict: 'in', via: STAR },
  GoalResult: { verdict: 'in', via: STAR },
  HookApprovalGate: { verdict: 'in', via: STAR },
  HookApprovalRequest: { verdict: 'in', via: STAR },
  JudgeResult: { verdict: 'in', via: STAR },
  MemoryAdapterErrorCode: { verdict: 'in', via: STAR },
  Verdict: { verdict: 'in', via: STAR },
}

interface Surface {
  readonly sdkValues: readonly string[]
  readonly sdkTypes: readonly string[]
  readonly crossingTypes: readonly string[]
}

let SURFACE: Surface

describe('the root bar has a type half, and it is now visible', () => {
  beforeAll(() => {
    const sdkRoot = join(
      dirname(require_.resolve('@theokit/sdk/package.json')),
      'dist',
      'index.d.ts',
    )
    const layerRoot = join(ROOT, 'dist', 'index.d.ts')
    const symbols = exportedSymbols([sdkRoot, layerRoot])
    const sdk = symbols.get(sdkRoot)
    const layer = symbols.get(layerRoot)
    if (sdk === undefined || layer === undefined) {
      throw new Error(
        'the compiler answered for neither root bar — with no symbols every assertion below is vacuous',
      )
    }
    const inLayer = new Set([...layer.values, ...layer.types])
    SURFACE = {
      sdkValues: sdk.values,
      sdkTypes: sdk.types,
      crossingTypes: sdk.types.filter((n) => inLayer.has(n)),
    }
  }, 120_000)

  it('test_the_compiler_SAW_the_type_half', () => {
    // COUNTERPROOF, and the whole point of the file: a runtime enumeration reports zero types by
    // construction, so a green run over zero would mean the instrument, not the surface.
    expect(SURFACE.sdkValues.length, 'no root-bar value was enumerated').toBeGreaterThan(50)
    expect(
      SURFACE.sdkTypes.length,
      'no root-bar TYPE was enumerated — this is what `Object.keys` reports, and why this file exists',
    ).toBeGreaterThan(100)
  })

  it('test_every_CROSSING_root_bar_type_has_a_verdict', () => {
    const withoutVerdict = SURFACE.crossingTypes.filter((n) => TYPE_VERDICTS[n] === undefined)
    expect(
      withoutVerdict,
      `root-bar type(s) crossing into this package with no verdict: ${withoutVerdict.join(', ')}.\n` +
        "A type that crosses widens this package's boundary. Write the decision — including how it " +
        'crosses, which is the half a star re-export hides.',
    ).toEqual([])
  })

  /**
   * Two different facts hid under one assertion until 2026-09-18, and the dep-check found it.
   *
   * A verdict naming a type that does not cross can mean the table rotted — somebody stopped
   * re-exporting the type and left the decision behind. It can also mean the INSTALLED SDK simply
   * predates the type: this package declares `@theokit/sdk: ^5.3.0`, `HookApprovalGate` landed in
   * `5.4.0`, and the `dep-check / suite at the bottom of every declared range` leg installs the
   * floor. There the table is not stale; the environment is older than the table.
   *
   * Collapsing the two made this gate fail on a floor where the package is correct — measured: the
   * typecheck was clean and 1070 test files passed beside it. `sdk-adapter-create-options.ts`
   * declares its own `HookApprovalGate` for exactly that reason, so the floor is honest and this
   * gate was the thing that was wrong.
   *
   * So the failure is scoped to the case that is actually rot: the SDK DEFINES the type and it no
   * longer crosses. A verdict for a type this SDK has never heard of is reported in the message and
   * does not fail — and the opposite direction, a crossing type with no verdict, stays unconditional
   * above, because a newer SDK adding a crossing type must still force a decision.
   */
  it('test_the_list_does_not_reference_a_type_that_no_longer_crosses', () => {
    const crossing = new Set(SURFACE.crossingTypes)
    const defined = new Set(SURFACE.sdkTypes)
    const absent = Object.keys(TYPE_VERDICTS).filter((n) => !crossing.has(n))
    const stale = absent.filter((n) => defined.has(n))
    const olderSdk = absent.filter((n) => !defined.has(n))
    expect(
      stale,
      `verdict(s) for type(s) the installed SDK defines and that no longer cross: ${stale.join(', ')}.` +
        (olderSdk.length > 0
          ? `\nNot counted, because the installed SDK does not define them at all — an older SDK, ` +
            `not a stale table: ${olderSdk.join(', ')}.`
          : ''),
    ).toEqual([])
  })

  it('test_a_via_of_NAMED_is_true_of_the_barrel', () => {
    // The `via` is a claim about `src/index.ts`, so it is checked against `src/index.ts` rather than
    // trusted. A wrong `via` would send a reader looking for a line that is not there.
    const source = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
    const lying = Object.entries(TYPE_VERDICTS)
      .filter(([, v]) => v.verdict === 'in' && v.via === NAMED)
      .filter(([name]) => !new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(source))
      .map(([name]) => name)
    expect(
      lying,
      `claimed as named in the root barrel and absent from it: ${lying.join(', ')}`,
    ).toEqual([])
  })

  it('test_a_via_of_STAR_is_true_of_the_barrel', () => {
    const source = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
    const lying = Object.entries(TYPE_VERDICTS)
      .filter(([, v]) => v.verdict === 'in' && v.via === STAR)
      .filter(([name]) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(source))
      .map(([name]) => name)
    expect(
      lying,
      `claimed as arriving by star and named in the barrel after all: ${lying.join(', ')}`,
    ).toEqual([])
  })
})
