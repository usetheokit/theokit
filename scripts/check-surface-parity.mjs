#!/usr/bin/env node
/**
 * SURFACE PARITY guard — "enriching never reduces" (M73).
 *
 * The `@theokit/agents` layer exists to ENRICH `@theokit/sdk`: to add OO where there is state or
 * orchestration to hold. It must never REDUCE — a symbol the SDK exposes and the layer does not
 * forward is unreachable to whoever consumes the layer.
 *
 * This is not theory. `agent-builder` holds an UNBREAKABLE rule never to import `@theokit/sdk*`
 * directly. When `@theokit/agents/auth` exported 1 value against the SDK's 19 symbols,
 * **reimplementing was the only legal way out** — and it rewrote six identical names, ~120 lines of
 * duplicated credential mechanics. The gap was the layer's; the duplication was only the symptom.
 *
 * ## The contract: a DECISION per symbol, not coverage
 *
 * Demanding that the layer forward EVERYTHING would leave this gate permanently red — there are
 * symbols it deliberately does not want to expose (internal device-flow detail), and one case where
 * forwarding would be ACTIVELY WRONG: `resolveCredential` exists on both sides with different
 * contracts.
 *
 * So the gate does not demand coverage. It demands a **written decision**: every SDK symbol is
 * `'covered'` or `{ out: '<reason>' }`. A new symbol with no decision breaks CI — which is cheap —
 * instead of vanishing silently, which is what cost 24 KB.
 *
 * The design comes from `check-package-direction.mjs`, the sibling guard, and from the lesson
 * written in its header:
 * *"a gate nobody can make green is a gate nobody reads"*.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Read, never hand-kept — the technique `check-package-direction.mjs` uses for the same reason. */
const AGENTS_MANIFEST = JSON.parse(readFileSync(join(ROOT, 'packages/agents/package.json'), 'utf8'))
const SDK_MANIFEST = JSON.parse(
  readFileSync(join(ROOT, 'node_modules/@theokit/sdk/package.json'), 'utf8'),
)
const TSUP = readFileSync(join(ROOT, 'packages/agents/tsup.config.ts'), 'utf8')

/**
 * Anti-vacuity floor, per subpath.
 *
 * If the enumeration returns fewer than this, the `import()` probably failed (broken build, subpath
 * missing from the `exports` field, incompatible version) and the list came back empty — making
 * "0 symbols without a decision" trivially true. A gate that cannot read anything is NOT approving
 * anything.
 */
const PISO_DE_SIMBOLOS = { auth: 15 }

/**
 * M86 — the gate walks EVERY subpath the layer publishes, not the one it was born for.
 *
 * The list of subpaths is read from `packages/agents/package.json#exports`, and each one's SDK
 * counterpart from the SDK's OWN `exports` map. Both are read rather than hand-kept, borrowing the
 * technique `check-package-direction.mjs` already uses: a guard with a hand-written list drifts the
 * first time somebody adds a subpath and forgets the list — which is the failure mode this whole
 * gate exists to prevent, reproduced one level up.
 *
 * ## Applicability, measured rather than assumed
 *
 * Only a subpath the SDK ALSO publishes under the same name has a parity question to answer. Of the
 * 20 the layer publishes, 6 do (`.`, `/sandbox`, `/persistence`, `/interactive`, `/auth`, `/client`).
 * The other 14 are the layer's own surfaces — `session`, `hooks`, `ask`, `tool-scope`, `commands`,
 * … — and asking "does it forward everything the SDK exports at that path" is not a weaker question
 * there, it is an undefined one. They are SKIPPED WITH A REASON, never silently.
 *
 * The honest headline is therefore "1 of 6 applicable", not "1 of 20". Overstating the denominator
 * would have made the gate look worse than it is and the work look bigger than it is.
 *
 * ## Warn mode carries a sunset
 *
 * Turning 5 new subpaths into hard errors in one commit leaves CI red until every symbol has a
 * written decision, and "a gate nobody can make green is a gate nobody reads" (this file, above).
 * So they warn first — and each warn-mode entry carries a SUNSET, past which it fails hard. Without
 * one, warn mode becomes the permanent state and the fix degrades into "we print something", which
 * is the pre-existing condition with extra output. Same discipline as
 * `code-quality-allowlist.txt` and `deps-audit-allowlist.txt`: an expired entry re-fires at full
 * severity.
 */
const SUNSET = {
  // subpath: the date its warn mode stops being tolerated (ISO, ≤ 90 days from introduction)
  '.': '2026-11-12',
  sandbox: '2026-11-12',
  persistence: '2026-11-12',
  interactive: '2026-11-12',
  client: '2026-11-12',
}

/** Today, injectable so the sunset check is testable without waiting for a calendar. */
const TODAY = process.env.SURFACE_PARITY_TODAY ?? new Date().toISOString().slice(0, 10)

/** Resolve the `.d.ts` the SDK publishes for a subpath, or `undefined` when it publishes none. */
function sdkTypesFor(subpath) {
  const key = subpath === '.' ? '.' : `./${subpath}`
  const entry = SDK_MANIFEST.exports?.[key]
  if (typeof entry !== 'object' || entry === null) return undefined
  // Two shapes in the wild: `types` at the top, or nested under a conditional `import` branch.
  const nested = typeof entry.import === 'object' ? entry.import?.types : undefined
  const types = entry.types ?? nested
  if (typeof types !== 'string') return undefined
  const resolved = join(ROOT, 'node_modules/@theokit/sdk', types)
  return existsSync(resolved) ? resolved : undefined
}

/** Where the layer's entry for a subpath lives. Read from tsup, so a rename cannot silently unhook it. */
function entryFileFor(subpath) {
  const key = subpath === '.' ? 'index' : subpath.replace(/\//g, '-')
  const q = String.raw`['"]`
  const match = TSUP.match(new RegExp(`${q}?${key}${q}?\\s*:\\s*${q}([^'"]+)${q}`))
  return match ? join(ROOT, 'packages/agents', match[1]) : undefined
}

/**
 * The decision, per SDK symbol. `'covered'` = the layer forwards it. `{ out }` = deliberately not,
 * with the reason written down — the reason is what separates a decision from an omission.
 */
const DECISIONS = {
  auth: {
    // — the store mechanics: a pure pass-through (M73). `re-exported` is VERIFIED against the entry.
    // M67 — `assertSecureModes` arrived with the `^4.49.0` floor (ADR 0060). It encodes a security
    // rule over auth modes; withholding it would leave restating that rule as the consumer's only
    // legal way out, and a second copy of a security rule diverges silently from the first.
    assertSecureModes: 're-exported',
    providerFromApiKeyPrefix: 'covered',
    authFilePath: 're-exported',
    CredentialError: 're-exported',
    credentialHome: 're-exported',
    readAuthFile: 're-exported',
    readStoredOAuth: 're-exported',
    writeCredential: 're-exported',
    ResolveCredentialOptions: 're-exported',

    // — the OAuth lifecycle: reachable through the `AuthProvider` class, which holds config+store. It
    // is NOT a re-export, and the distinct token exists so the gate does not assert what it did not check.
    ensureFreshCredential: 'via-AuthProvider',
    openaiDeviceLogin: 'via-AuthProvider',
    persistOAuthTokens: 'via-AuthProvider',

    // — out of scope, with a reason
    resolveCredential: {
      out:
        'the SDK and the consumer have DIFFERENT functions under this name (sync vs async, throws vs ' +
        'undefined, reads env vs does not, infers the provider vs refuses). The SDK itself declares ' +
        "that env precedence, prefix inference and the declared provider are the consumer's app " +
        'policy. Exposing both in the same scope would invite importing the wrong one, failing silently.',
    },
    deviceLogin: {
      out: 'a generic device-flow primitive; the layer exposes `openaiDeviceLogin`, which is the real route',
    },
    requestDeviceCode: {
      out: 'an internal device-flow step, orchestrated by `openaiDeviceLogin`',
    },
    requestOpenAIUsercode: { out: 'likewise — an internal step, not consumer surface' },
    pollDeviceToken: { out: 'likewise — the polling is a detail of `openaiDeviceLogin`' },
    exchangeCode: { out: 'an internal step of the authorization-code flow' },
    refreshOAuthTokens: {
      out: 'the layer exposes `AuthProvider.ensureFresh`, which decides WHEN to refresh',
    },
    parseJwtClaims: { out: "a parsing utility unrelated to the layer's auth contract" },
    extractAccountId: { out: 'likewise — a claim-reading detail' },
  },
}

const problems = []

const warnings = []
const skipped = []

for (const key of Object.keys(AGENTS_MANIFEST.exports ?? {})) {
  const subpath = key === '.' ? '.' : key.replace('./', '')
  const dts = sdkTypesFor(subpath)

  // No same-named SDK subpath ⇒ no parity question. Skipped WITH A REASON: a silent skip is how a
  // gate ends up certifying surfaces it never looked at.
  if (dts === undefined) {
    skipped.push(
      `${key} — the SDK publishes no subpath under this name; the layer owns it outright`,
    )
    continue
  }

  // Having a decision registry IS being hard-gated: the registry is what the loop below compares
  // against, so a subpath with one fails on the first undecided symbol. `auth` is the only one today.
  const decisoes = DECISIONS[subpath]
  if (decisoes === undefined) {
    const sunset = SUNSET[subpath]
    if (sunset === undefined) {
      problems.push(
        `\`${key}\` has an SDK counterpart and NO decision registry, and no sunset either.\n` +
          '  Every applicable subpath is either decided or explicitly deferred with a date. An\n' +
          '  indefinite deferral is how warn mode becomes the permanent state.',
      )
      continue
    }
    if (TODAY >= sunset) {
      problems.push(
        `\`${key}\` was deferred until ${sunset} and that date has passed.\n` +
          '  Warn mode carries a sunset precisely so it cannot become permanent — write the\n' +
          `  decisions for this subpath in ${'scripts/check-surface-parity.mjs'}, or move the date with a reason.`,
      )
      continue
    }
    warnings.push(
      `${key} — no decision registry yet (warn mode since 2026-08-14, hard-fails from ${sunset})`,
    )
    continue
  }

  let source
  try {
    source = readFileSync(dts, 'utf8')
  } catch (err) {
    problems.push(
      `COULD NOT READ the surface of \`@theokit/sdk/${subpath}\` (${dts}): ${err.message}\n` +
        '  This is NOT approval: without reading the SDK exports the gate has nothing to compare.',
    )
    continue
  }

  // Three emitted forms, because the `.d.ts` uses all three and reading only one lets a new symbol
  // through WITHOUT a decision — silently, which is exactly the defect this gate exists to prevent.
  // The anti-vacuity floor does not protect against it: with the `export { … }` block intact the
  // count stays above the floor and only the new symbol disappears.
  const blockNames = [...source.matchAll(/export\s*\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(','))
    // `a as b` re-exports under the name `b` — that is what the consumer sees.
    .map((t) =>
      t
        .replace(/\btype\b/, '')
        .split(/\bas\b/)
        .pop()
        .trim(),
    )
  const declaredNames = [
    ...source.matchAll(/export\s+declare\s+(?:function|class|const|let|var)\s+(\w+)/g),
  ].map((m) => m[1])
  const declaredTypes = [...source.matchAll(/export\s+(?:type|interface)\s+(\w+)/g)].map(
    (m) => m[1],
  )
  const exports = [
    ...new Set(
      [...blockNames, ...declaredNames, ...declaredTypes].filter((n) => /^[A-Za-z_]\w*$/.test(n)),
    ),
  ]

  // What the layer's entry ACTUALLY re-exports. Without this, `re-exported` is a claim the gate never
  // checked: removing a symbol from `auth-entry.ts` left everything green (review F-02).
  const entryPath = entryFileFor(subpath)
  if (entryPath === undefined || !existsSync(entryPath)) {
    problems.push(
      `Could not locate the layer entry for \`${key}\` via tsup.config.ts.\n` +
        '  Without the entry the `re-exported` decisions are unchecked claims.',
    )
    continue
  }
  const entry = readFileSync(entryPath, 'utf8')
  const reExported = new Set(
    [...entry.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}\s*from/g)]
      .flatMap((m) => m[1].split(','))
      .map((t) =>
        t
          .replace(/\btype\b/, '')
          .split(/\bas\b/)
          .pop()
          .trim(),
      )
      .filter(Boolean),
  )

  // ANTI-VACUITY ANCHOR. Without it, a broken enumeration returns [] and the loop below never runs:
  // "0 symbols without a decision" becomes trivially true and the gate certifies without looking.
  const floor = PISO_DE_SIMBOLOS[subpath] ?? 1
  if (exports.length < floor) {
    problems.push(
      `The enumeration of \`@theokit/sdk/${subpath}\` found ${exports.length} symbols (floor ${floor}).\n` +
        '  Reading the exports probably broke — and a gate that finds nothing passes by VACUITY,\n' +
        '  not by parity. Fix the enumeration before trusting this result.',
    )
    continue
  }

  for (const name of exports) {
    const d = decisoes[name]
    if (d === undefined) {
      problems.push(
        `\`${name}\` is exported by \`@theokit/sdk/${subpath}\` and has NO registered decision.\n` +
          `  The layer must never REDUCE the SDK surface: a symbol it does not forward is unreachable\n` +
          '  to anyone who cannot import the SDK directly — and their way out becomes reimplementing.\n' +
          '  Write the decision in scripts/check-auth-parity.mjs:\n' +
          `    ${name}: 'covered'                           // and re-export it in src/${subpath}-entry.ts\n` +
          `    ${name}: { out: '<why it does not cross>' }  // an explicit decision, not an omission`,
      )
      continue
    }
    if (d === 're-exported' && !reExported.has(name)) {
      problems.push(
        `\`${name}\` is declared as \`'re-exported'\` but \`src/${subpath}-entry.ts\` does NOT re-export it.\n` +
          '  The decision said it crosses, and it does not — the list became an unchecked claim.\n' +
          `  Either add the symbol to the re-export, or change the decision to \`'via-AuthProvider'\` / \`{ out }\`.`,
      )
      continue
    }
    if (typeof d === 'object' && !String(d.out ?? '').trim()) {
      problems.push(
        `\`${name}\` is marked out of scope with NO written reason.\n` +
          '  An allowlist without reasons becomes a dead list nobody reviews — write why it does not cross.',
      )
    }
  }

  for (const name of Object.keys(decisoes)) {
    if (!exports.includes(name)) {
      problems.push(
        `\`${name}\` has a registered decision but the SDK NO LONGER exports it.\n` +
          '  A dead entry misleads whoever reads the list — remove it.',
      )
    }
  }
}

for (const s of skipped) console.log(`  · skipped: ${s}`)
for (const w of warnings) console.warn(`  ! WARN: ${w}`)

if (problems.length > 0) {
  console.error('\n✗ surface parity SDK → layer\n')
  for (const p of problems) console.error(`  • ${p}\n`)
  process.exit(1)
}

const applicable = Object.keys(AGENTS_MANIFEST.exports ?? {}).length - skipped.length
console.log(
  `✓ surface parity: ${applicable - warnings.length}/${applicable} applicable subpath(s) decided; ` +
    `${warnings.length} in warn mode; ${skipped.length} have no SDK counterpart`,
)
