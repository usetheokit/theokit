/**
 * M68 T2 — enabling the repository source with a string literal does not compile.
 *
 * COMPILE-time assertions. Every `@ts-expect-error` below **must** error; the test breaks the day one
 * of them stops erroring, which is the day the unsafe path was born again.
 *
 * ## What this file protects
 *
 * `settingSources` enables on-disk config discovery. `'user'` reads `~/.theokit/` — the operator's
 * own machine, which no third party controls. `'project'` reads `<cwd>/.theokit/`, **including
 * `hooks.json`, which executes shell**. For an agent whose `cwd` is a repository the user just
 * cloned, `<cwd>/.theokit/` is attacker content.
 *
 * The previous JSDoc documented that risk and justified it with "`.theokit/` is the app's own repo".
 * Documenting did not prevent it: the measured consumer (TheoCode) did not trust the API and gated
 * from the outside, with a `posture.allows` of its own. The gate existed on its side and evaporated
 * at the boundary.
 *
 * Closed type control, not lint: the wrong call is not born. Residue declared, in the mould of the
 * `Agent.list` narrowing (M103) — it binds TypeScript consumers only; a `.js` caller or an `as any`
 * escapes, and the runtime refusal (T3) is what covers them.
 */
import type { SettingSourcesSelection, TrustPosture } from '../../src/index.js'

declare const trusted: TrustPosture<'projectSettings'>

  // ── 1. The safe path stays trivial ────────────────────────────────────────────────────────────
  // If refusing demanded ceremony from the safe path, the friction would push the consumer to turn
  // the gate off — the opposite of the intent.
;({ user: true }) satisfies SettingSourcesSelection
;({}) satisfies SettingSourcesSelection

// ── 2. The repository source requires the evidence ────────────────────────────────────────────
;({ project: { trustedBy: trusted } }) satisfies SettingSourcesSelection
;({ user: true, project: { trustedBy: trusted } }) satisfies SettingSourcesSelection

// ── 3. The shapes that must NOT compile ───────────────────────────────────────────────────────
{
  // @ts-expect-error — the old shape: an array of literals. It is the call site this milestone kills.
  ;['project', 'user'] satisfies SettingSourcesSelection
}
{
  // @ts-expect-error — a boolean in place of the evidence. Turning on the dangerous source is not an opinion.
  ;({ project: true }) satisfies SettingSourcesSelection
}
{
  // @ts-expect-error — `trustedBy` absent: the object exists, the evidence does not.
  ;({ project: {} }) satisfies SettingSourcesSelection
}
{
  // @ts-expect-error — a string in place of the posture. Claiming trust is not proving it; it was
  // exactly the shape of `auto-approve` that M77 will fix for the same reason.
  ;({ project: { trustedBy: 'trust me' } }) satisfies SettingSourcesSelection
}
