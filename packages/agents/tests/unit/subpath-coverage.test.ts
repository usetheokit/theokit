/**
 * M78 T2.1 — the coverage policy: a list of DECISIONS, not of inclusions.
 *
 * ## The problem this file closes
 *
 * The layer's barrel grew **reactively** — symbol by symbol, under bug pressure. The measured
 * result: the SDK publishes 28 subpaths and the layer covered 9. Nothing warned when the SDK gained
 * a new subpath, so "nobody has decided yet" was indistinguishable from "we decided it stays out".
 *
 * ## Why a DECISION and not an allowlist
 *
 * An allowlist of only what enters lets a new subpath fall silently into the "undecided" category.
 * That is exactly how coverage reached 9 of 28 without anyone noticing. Here, **every** subpath needs
 * a verdict: `in` (and the test verifies that it crosses) or `out` (with a written reason).
 *
 * The test fails when a **verdict is missing** — not when the verdict is `out`. That is what
 * separates a policy from a wall: a new subpath in the SDK breaks the layer's build **once**, and the
 * fix is writing one line saying what was decided, including "out of scope because X".
 *
 * Precedent for the format: `rules/code-quality-golden-rule.md § 4` already requires a mandatory
 * reason on every allowlist entry, for the same motive — an exception without a reason is never
 * revisited.
 *
 * ## Referential identity, inherited from M73
 *
 * `auth-parity.test.ts` already explained why the assertion is `toBe` and not `toBeDefined`: if the
 * build inlines the SDK (`noExternal` in tsup), the layer starts exporting a **copy** of the class,
 * `instanceof` silently becomes `false` and **no behavioural test goes red**. A `toBeDefined` does
 * not catch that.
 */
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/** A subpath re-exported by the layer, with the symbols that must cross. */
interface Inside {
  readonly verdict: 'in'
  /**
   * `'total'` — every export of the subpath crosses, and the test verifies it by enumerating the SDK
   * module. `'sample'` — only the listed `symbols` are verified.
   *
   * The distinction was born of a real defect in this milestone: the first version only sampled, and
   * `RateLimitError` — which the OAuth refresh needs to recognize a 429 — was left out of the
   * re-export with nothing flagging it. Sampling proves that SOMETHING crosses, not that the domain
   * crosses.
   */
  readonly coverage: 'total' | 'sample'
  /** Names knowingly NOT covered, with the reason. Only valid with `coverage: 'total'`. */
  readonly gaps?: Readonly<Record<string, string>>
  /**
   * Key symbols verified by referential identity.
   *
   * An empty list is legitimate ONLY when `via` is a subpath owned by the layer (`/auth`, `/sandbox`,
   * …): there the coverage is the whole subpath, and M73 already has a dedicated parity test
   * (`auth-parity.test.ts`). For an `in` through the barrel, an empty list would be an UNVERIFIED
   * verdict — exactly the defect this policy exists to prevent, and the test
   * `test_in_via_the_barrel_declares_symbols` forbids it.
   */
  readonly symbols: readonly string[]
  /**
   * Where the layer exposes them from. It is the SOURCE path (`../../src/…`), not the package name.
   *
   * The first version used `'@theokit/agents'`, which resolves to the package INSTALLED in
   * `node_modules` — so the test measured the published version, not the tree under test, and a
   * freshly written re-export stayed red. `auth-parity.test.ts` (M73) already imported from source
   * for the same reason; I did not follow the precedent and paid for it.
   */
  readonly via: string
  /** Set when only one supported major has this. See `installedSdkMajor`. */
  readonly sinceMajor?: number
}

/** A subpath deliberately out, with the reason — which is mandatory. */
interface Fora {
  readonly verdict: 'out'
  readonly reason: string
  /** Set when only one supported major publishes this subpath. See `installedSdkMajor`. */
  readonly sinceMajor?: number
}

type Decision = Inside | Fora

/**
 * The decision list. Every subpath the SDK publishes appears here.
 *
 * Adding a subpath to the SDK and not to this list breaks `test_every_sdk_subpath_has_a_verdict` —
 * deliberately.
 */
/** The major of the SDK actually installed; the supported range spans two. */
function installedSdkMajor(): number {
  const require_ = createRequire(import.meta.url)
  const { version } = require_('@theokit/sdk/package.json') as { version: string }
  return Number(version.split('.')[0])
}

const DECISIONS: Record<string, Decision> = {
  // ── Arrived with `@theokit/sdk@5.x`. Each needed a verdict, and the reason each is `out` is
  // different — which is the point of recording decisions rather than an allowlist.
  './providers': {
    sinceMajor: 5,
    verdict: 'out',
    reason:
      'Model-provider discovery (`listProviders`, `getProviderProfile`). This layer never chooses a ' +
      'provider: it wires agents over whatever the SDK resolved, and a consumer that wants the ' +
      'catalogue reaches the SDK directly. Crossing it here would put a second, staler copy of the ' +
      'provider list in front of consumers for no capability they do not already have.',
  },
  './mcp-auth': {
    sinceMajor: 5,
    verdict: 'out',
    reason:
      'MCP OAuth token handling (`runPkceFlow`, `getTokens`, `setTokens`, `lockedRefresh`). Deliberately ' +
      'NOT re-exported: these read and write credential storage, and a token seam should have one ' +
      'import path so an audit of who touches tokens has one answer. Widening the surface to ' +
      'credentials is the opposite of what a convenience barrel is for.',
  },
  './internal/memory-store': {
    sinceMajor: 5,
    verdict: 'out',
    reason:
      'A SEMVER-EXEMPT path, by the `internal/` prefix the SDK uses to say so. It exists for ' +
      '`@theokit/sdk-memory` to share the store implementation (usetheokit/theokit-sdk#554 added ' +
      '`memoryIndexRoot` to it). Crossing the layer with a path the SDK declares free to break in a ' +
      'minor would hand consumers a stable-looking name over an unstable contract.',
  },
  '.': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'sample',
    // M80 — `JudgeCredentialError` enters the barrel's sample: it is the error the judge's fail-fast
    // throws, and a consumer behind the boundary needs it to tell a judge-credential failure from any
    // other goal-loop failure.
    symbols: ['Agent', 'Squad', 'Tool', 'Provider', 'JudgeCredentialError'],
  },
  './errors': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'total',
    symbols: ['TheokitAgentError', 'AuthenticationError', 'isTransientError', 'RateLimitError'],
    // M91 — the `BudgetExceededError` `gap` is GONE: the layer's class was renamed to
    // `DelegationBudgetExceededError` (with a `@deprecated` alias for one major), and the barrel now
    // exports BOTH. The reason written here said renaming was breaking and out of M78's scope — M91
    // paid the bill, and the gap goes away with the conflict that created it.
  },
  './retry': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'total',
    symbols: ['Retry'],
  },
  './concurrency': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'total',
    symbols: ['Semaphore', 'mapWithConcurrency'],
  },
  './messages': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'total',
    symbols: ['assistantText', 'extractToolUses', 'costAmountUsd'],
  },
  './models': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'total',
    symbols: ['parseModelId'],
  },
  './compaction': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'sample',
    symbols: ['resolveEffectiveContextWindow', 'CONTEXT_WINDOW_MARGIN'],
  },
  './path-safety': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'sample',
    symbols: ['isForbiddenPath', 'safePathJoin', 'assertNoSymlinkEscape'],
  },
  './subagents-loader': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'sample',
    // M81 — the on-disk subagent loader. It crosses because the opposite asymmetry (skills with a
    // public door, subagents without) is what made the consumer write a SECOND `.md` parser, along
    // with a test whose only job was to watch the two diverge.
    symbols: ['discoverSubagents', 'loadSubagentDefinition'],
  },
  './a2a': {
    verdict: 'in',
    via: '../../src/index.js',
    coverage: 'sample',
    symbols: ['SubAgent'],
  },
  './auth': { verdict: 'in', via: '../../src/auth-entry.js', coverage: 'sample', symbols: [] },
  './sandbox': {
    verdict: 'in',
    via: '../../src/sandbox-entry.js',
    // M90 — this was `'sample'` with an EMPTY list, which is no sample at all. This file's own
    // comment says sampling "proves that SOMETHING crosses, not that the domain crosses"; a sample of
    // size zero does not prove even that. It became `'total'` when the entry stopped being an
    // `export *`: now every export of the source is enumerated, so total coverage passes with no `gaps`.
    coverage: 'total',
    symbols: [],
  },
  './persistence': {
    gaps: {
      LiveTranscriptError:
        'the 5.x name for `LiveSessionError`, and absent from the 4.x half of the range this ' +
        'package supports — re-exporting it unconditionally fails the DTS build against 4.52.1 ' +
        '(measured). 5.x keeps the old name working and deprecated, so the name that crosses is ' +
        'the one both majors have. Revisit when the floor moves past 4.x.',
    },
    verdict: 'in',
    via: '../../src/persistence-entry.js',
    // M90 — this was `'sample'` with an EMPTY list, which is no sample at all. This file's own
    // comment says sampling "proves that SOMETHING crosses, not that the domain crosses"; a sample of
    // size zero does not prove even that. It became `'total'` when the entry stopped being an
    // `export *`: now every export of the source is enumerated, so total coverage passes with no `gaps`.
    coverage: 'total',
    symbols: [],
  },
  './interactive': {
    verdict: 'in',
    via: '../../src/interactive-entry.js',
    // M90 — this was `'sample'` with an EMPTY list, which is no sample at all. This file's own
    // comment says sampling "proves that SOMETHING crosses, not that the domain crosses"; a sample of
    // size zero does not prove even that. It became `'total'` when the entry stopped being an
    // `export *`: now every export of the source is enumerated, so total coverage passes with no `gaps`.
    coverage: 'total',
    symbols: [],
  },

  // --- OUT, with a reason. None of these is silent. ---
  './internal/memory-adapters': {
    verdict: 'out',
    reason:
      'A SEMVER-EXEMPT subpath, published by `@theokit/sdk@4.39.0` (theokit#160) with a single ' +
      'purpose: letting `@theokit/sdk-memory` reuse the SDK embedding runtime instead of keeping the ' +
      '342-line copy that caused the adapter gap in theokit#128. Crossing the layer with it would put ' +
      'a path the SDK declares free to break in a minor onto the public surface — the opposite of the ' +
      'contract this list exists to protect.',
  },
  './context': {
    verdict: 'out',
    reason:
      'Landed in SDK 4.42.0 as "a sanctioned public barrel for context assembly" and reached us with ' +
      'the M67 floor bump — it is NEW here, not long-ignored. The decision to cross it belongs to ' +
      'M74 (instruction tree), which is the milestone that will actually consume it and can judge it ' +
      'against what the barrel contains rather than against its name. Crossing it now would publish ' +
      'a surface nobody in this repo calls, which G7 forbids and which would freeze a shape before ' +
      'the consumer exists.',
  },
  './cron': {
    verdict: 'out',
    reason:
      "Scheduling is the host's responsibility (systemd/CI/cloud scheduler), not the agent's. No " +
      'consumer asked for it, and exposing it creates the expectation that the layer manages the ' +
      'lifecycle.',
  },
  './skills': {
    verdict: 'out',
    reason:
      'The layer has its own `skills-resolver.ts`, which is the OO surface of that domain. Exposing ' +
      'the SDK primitive alongside it would create two doors to the same thing.',
  },
  './project': {
    verdict: 'out',
    reason: 'Project-root discovery — the consumer resolves the cwd on its own. No demand.',
  },
  './subagents': {
    verdict: 'out',
    reason:
      'Delegation arrives through `SubAgent` (via `/a2a`, already `in`). This subpath is the file ' +
      'loading mechanics, which is an internal runtime detail.',
  },
  './task-store': {
    verdict: 'out',
    reason:
      'Task persistence is internal to the runtime; the consumer observes through `Run`, not the store.',
  },
  './workflow': {
    verdict: 'out',
    reason:
      'Workflow orchestration is a domain the layer has not modelled yet. It enters when there is real demand.',
  },
  './eval': {
    verdict: 'out',
    reason: 'Evaluation tooling is development-time, not agent runtime.',
  },
  './server/auth': {
    verdict: 'out',
    reason:
      'An HTTP server surface; this layer is about agents. `@theokit/http` is the package for that domain.',
  },
  './server/errors-envelope': {
    verdict: 'out',
    reason: 'Same reason as `/server/auth` — an HTTP transport error envelope, not an agent one.',
  },
  './subscription': {
    verdict: 'out',
    reason: 'Billing/quota belongs to the product, not to the agent framework.',
  },
  './sanitize': {
    verdict: 'out',
    reason:
      'Secret redaction is applied by the SDK runtime on its own sinks. Exposing it invites the ' +
      'consumer to redact by hand, which is where a path gets forgotten.',
  },
  './internal/persistence': {
    verdict: 'out',
    reason: "Marked `internal/` by the SDK itself — re-exporting contradicts the source's intent.",
  },
  './internal/security': {
    verdict: 'out',
    reason: 'Idem `internal/persistence`.',
  },
  './client': {
    verdict: 'out',
    reason:
      'The cloud-mode HTTP client; this layer covers local mode. It enters if/when cloud is supported here.',
  },
  './filesystem': {
    verdict: 'out',
    reason:
      'The file operations the consumer needs arrive as TOOLS (`@theokit/agents/tools`), which already ' +
      'carry the scope guard. The raw primitive would bypass that guard.',
  },
}

/**
 * M90 — why `/tools` and `/pty` are NOT in this map.
 *
 * M90's review pointed out, correctly, that they were left without an oracle — 98 of 173 symbols
 * (57%), and it was through there that `TruncationMode` disappeared from the published surface of
 * `4.25.0`. The fix was **not** to extend them here: this map enumerates `@theokit/sdk` subpaths, and
 * `/tools` and `/pty` come from SIBLING packages (`@theokit/sdk-tools`, `@theokit/sdk-pty`). Bringing
 * them in would require a second source of truth alongside this one, and two lists that must stay in
 * sync is the defect this very file's F-10 review recorded (the copy that lost `bench` while the
 * comment swore "same scope").
 *
 * What covers the five is `subpath-surface.test.ts`, with an oracle STRONGER than `coverage: 'total'`:
 * it compares what the layer emits (`dist/*.d.ts`) against what the source exports, in both directions.
 */
const SUBPATHS_DO_SDK = Object.keys(
  (require_('@theokit/sdk/package.json') as { exports: Record<string, unknown> }).exports,
).filter((k) => k !== './package.json')

/**
 * Every module the cases read, imported ONCE at module scope.
 *
 * This was a `beforeAll` and the comment there claimed it "removes the race instead of lengthening
 * the track". It shortened the track and left the race: a hook has a bound too, and the default is
 * 10 s. Measured 2026-09-25 — the file passes alone in 4.96 s (`import 130ms`) and passes with the
 * whole `packages/agents` suite (289 files), but a full root run (1145 files) produced
 * `Error: Hook timed out in 10000ms` and the run line read `(40 tests | 40 skipped)`. One reported
 * failure, forty verdicts that decided nothing.
 *
 * Raising `hookTimeout` was the obvious answer and is the wrong one twice over: the number would be
 * a guess about somebody else's machine, and it keeps the cost inside a bounded hook. Module scope
 * has no hook bound at all — the same work, outside the thing that was timing it out. A failure
 * here surfaces as the file failing to load, which is louder and more honest than forty skips.
 *
 * Verified after the move: a full root run of 1145 files with the default 10 s hook bound.
 */
const LOADED = new Map<string, Record<string, unknown>>()
{
  const specifiers = new Set<string>()
  for (const [, decision] of Object.entries(DECISIONS)) {
    if (decision.verdict === 'in') specifiers.add(decision.via)
  }
  for (const [subpath, decision] of Object.entries(DECISIONS)) {
    if (decision.verdict === 'in' && decision.coverage === 'total') {
      specifiers.add(`@theokit/sdk${subpath.slice(1)}`)
    }
  }
  await Promise.all(
    [...specifiers].map(async (specifier) => {
      LOADED.set(specifier, (await import(specifier)) as Record<string, unknown>)
    }),
  )
}

describe('M78 T2.1 — subpath coverage policy', () => {
  it('test_every_sdk_subpath_has_a_verdict', () => {
    const withoutDecision = SUBPATHS_DO_SDK.filter((s) => DECISIONS[s] === undefined)

    expect(
      withoutDecision,
      `SDK subpath(s) with no verdict: ${withoutDecision.join(', ')}.\n` +
        'This is intentional: a new subpath in the SDK breaks this test ONCE, and the fix is writing ' +
        'the decision into DECISIONS — including `out` with a reason. Without it, "nobody decided" ' +
        'stays indistinguishable from "we decided it stays out", which is how coverage reached 9 of 28.',
    ).toEqual([])
  })

  it('test_the_list_does_not_reference_a_NONEXISTENT_subpath', () => {
    // The inverse: an orphan decision (a subpath removed from the SDK) must show up too, otherwise
    // the list accumulates dead entries and starts lying about what was decided.
    // The range spans two majors (`^4.52.1 || ^5.0.0`), so a decision about a 5.x-only subpath is
    // not rot when the tree is on 4.x — it is a decision waiting for the other half of the range.
    const installedMajor = installedSdkMajor()
    const orphans = Object.keys(DECISIONS).filter((s) => {
      if (SUBPATHS_DO_SDK.includes(s)) return false
      const since = DECISIONS[s].sinceMajor
      return since === undefined || installedMajor >= since
    })
    expect(
      orphans,
      `Decision for a subpath the SDK no longer publishes: ${orphans.join(', ')}`,
    ).toEqual([])
  })

  it('test_in_via_the_barrel_declares_symbols', () => {
    // An `in` with no symbol is a verdict that verifies nothing — it documents coverage without
    // proving it. It is only acceptable when the layer has its OWN subpath for the domain (there the
    // subpath is the coverage).
    const unverified = Object.entries(DECISIONS)
      .filter(
        ([, d]) => d.verdict === 'in' && d.symbols.length === 0 && d.via === '../../src/index.js',
      )
      .map(([s]) => s)
    expect(
      unverified,
      `\`in\` through the barrel with no declared symbol: ${unverified.join(', ')}. ` +
        'A verdict that verifies nothing is worse than none — it asserts coverage nobody checked.',
    ).toEqual([])
  })

  it('test_every_OUT_verdict_has_a_non_empty_reason', () => {
    // COUNTERPROOF for the policy. Without this, an `out` with no reason would become the silent
    // allowlist the format exists to prevent — and nobody would revisit the decision.
    const withoutReason = Object.entries(DECISIONS)
      .filter(([, d]) => d.verdict === 'out' && (d as Fora).reason.trim().length < 20)
      .map(([s]) => s)
    expect(
      withoutReason,
      `\`out\` verdict with no written reason: ${withoutReason.join(', ')}`,
    ).toEqual([])
  })

  const entries = Object.entries(DECISIONS).filter(
    (e): e is [string, Inside] => e[1].verdict === 'in' && e[1].symbols.length > 0,
  )

  /** Reads the module map. Fails loud if the specifier was never collected — never imports late. */
  const moduleOf = (specifier: string): Record<string, unknown> => {
    const mod = LOADED.get(specifier)
    if (mod === undefined) {
      throw new Error(`\`${specifier}\` was not pre-loaded; the specifier set is stale`)
    }
    return mod
  }

  it.each(entries)('test_the_symbols_of_%s_CROSS_the_layer', (subpath, decision) => {
    // The `in` is VERIFIED, not trusted. A decision saying "in" for a subpath that does not cross is
    // worse than no decision: it documents coverage that does not exist.
    const layer = moduleOf(decision.via)
    for (const name of decision.symbols) {
      expect(
        layer[name],
        `\`${name}\` (from ${subpath}) does not cross the layer through ${decision.via}`,
      ).toBeDefined()
    }
  })

  const totals = Object.entries(DECISIONS).filter(
    (e): e is [string, Inside] => e[1].verdict === 'in' && e[1].coverage === 'total',
  )

  it.each(totals)('test_%s_crosses_ENTIRELY_and_not_by_sample', (subpath, decision) => {
    // The test that exists because of a real defect: the first version only sampled symbols, and
    // `RateLimitError` was left out of the re-export with nothing flagging it — the OAuth refresh
    // needed it to recognize a 429. Sampling proves SOMETHING crosses, not that the DOMAIN crosses.
    const layer = moduleOf(decision.via)
    const sdk = moduleOf(`@theokit/sdk${subpath.slice(1)}`)

    const missing = Object.keys(sdk).filter(
      (name) => layer[name] === undefined && decision.gaps?.[name] === undefined,
    )
    expect(
      missing,
      `Exports of ${subpath} that do not cross: ${missing.join(', ')}. ` +
        'Either re-export them, or record them in `gaps` with the reason — a half hierarchy makes the ' +
        'consumer recreate the missing class, which is the defect this milestone closes.',
    ).toEqual([])
  })

  it.each(totals)('test_the_gaps_of_%s_have_a_written_reason', (_subpath, decision) => {
    // COUNTERPROOF: without this, `gaps` would become the silent allowlist the policy forbids.
    for (const [name, reason] of Object.entries(decision.gaps ?? {})) {
      expect(reason.trim().length, `gap \`${name}\` with no written reason`).toBeGreaterThan(30)
    }
  })

  it.each(entries)(
    'test_the_symbols_of_%s_are_the_SAME_reference_as_the_sdk',
    async (subpath, decision) => {
      // `toBe`, not `toBeDefined` — M73's lesson. A wrapper would pass the previous test and break
      // `instanceof` here, silently, with no behavioural test going red.
      const layer = (await import(decision.via)) as Record<string, unknown>
      const sdk = (await import(`@theokit/sdk${subpath.slice(1)}`)) as Record<string, unknown>
      for (const name of decision.symbols) {
        expect(layer[name], `\`${name}\` crosses as a COPY, not as the SDK class`).toBe(sdk[name])
      }
    },
  )
})
