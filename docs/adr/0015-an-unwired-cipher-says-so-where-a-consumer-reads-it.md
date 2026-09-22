# ADR 0015 — An unwired cipher says so where a consumer reads it

- **Status:** accepted
- **Date:** 2026-09-21
- **Decider:** the autonomous maintenance chain, under `rules/autonomy-envelope.md`
  § *A structural decision the contract wants recorded*
- **Relates to:** ADR 0007, B-211, `docs/program/capability-matrix.md:105`

## Context

`@theokit/http/action-encryption` publishes three symbols — `deriveActionKey`,
`encryptActionArgs`, `decryptActionArgs`. Re-measured 2026-09-21 over `packages/*/src` and
`apps/*/src`: **1, 2 and 1 occurrences, every one of them inside the file that defines them, and
zero files outside it.** One test exercises them.

That is the same property ADR 0007 measured for `./css-resource` and `./server-inserted-html`,
and the three files sit together in the range that ADR cites. `docs/program/capability-matrix.md`
already records this one as "callable directly; nothing in the action pipeline uses it".

ADR 0007 declined to absorb it, in its own words: *"quietly extending an accepted decision to a
symbol nobody argued about would be widening it rather than applying it."* This is the argument it
asked for.

## Why this one is not simply the third of three

`./css-resource` is a CSS helper and `./server-inserted-html` is an HTML buffer. An unused helper
is inert: a consumer who finds it either uses it or does not, and either way nothing is promised.

**This is a cipher, and an unused cipher is not inert.** It is published beside an action pipeline,
its own header says "a server-action payload cipher for the SSR path", and the pipeline does not
call it. A consumer reading the API can reasonably conclude that action arguments are encrypted.
They are not. The failure mode is not an unused export — it is a false belief about what the
framework already does for you, and that belief is only corrected by reading the pipeline.

So the deprecation here carries a sentence the other two do not need: **what this does NOT do.**

## Decision

**`@theokit/http/action-encryption` is marked deprecated and keeps working**, on ADR 0007's terms —
no removal in the 2.x line, removal only as a 3.0 change with the deprecation published ahead of it.

Each of the three exports states the condition under which it is still the right tool: a caller
encrypting an action payload **explicitly, in their own code**. Each also states the thing the
matrix knows and the package did not say — that nothing in the action pipeline calls it, so using
it is an opt-in and never a framework guarantee.

## Who is affected

Any consumer importing `@theokit/http/action-encryption`. **Measured zero in this repository and in
`apps/`; unknown outside it**, which is the whole reason the decision is deprecate rather than
delete. A deprecation is a compile-time notice and changes no behaviour, so nobody's build breaks.

## What would break, and what would not

**Nothing breaks.** `@deprecated` is a JSDoc annotation: the subpath, the exports, the algorithm
and the output format are unchanged, and a consumer's editor shows a strikethrough. The published
`.d.ts` gains the annotation and nothing else.

What would break is deletion, and that is the next section.

## What was rejected

**Delete it.** ADR 0007 rejected deletion for its two on a ground that applies here unchanged:
the measurement covers this repository and the package is published, so *"no importer I can see"*
and *"no importer"* are different claims and only the first is supported.

**Extend ADR 0007 to cover it.** Rejected by ADR 0007 itself, which is why this file exists.

**Wire it into the action pipeline instead.** Rejected here, and deliberately not decided against
for ever: whether action arguments SHOULD be encrypted by default is a product question about a
security posture, not a maintenance call about an orphan. It changes the wire format, it needs a
secret the framework does not currently require, and `cycle-brainstorm` is where it belongs. Filing
it as the answer to an orphan would be deciding a product question by accident.

**Leave it undecided.** Rejected because that is the state B-211 was filed against, and ADR 0007
already paid for that lesson: *"an orphan nobody has decided about is re-measured by the next person
at full cost."*

## One property recorded rather than fixed

`deriveActionKey` derives its PBKDF2 salt from the secret — `theo-action-salt:${secret.slice(0, 8)}`
— so the salt is deterministic per secret rather than random per key. The function's own docstring
already scopes it correctly ("suitable for action encryption where the secret is a server-side
session secret — not for password hashing"), and a fixed salt against a high-entropy server secret
is a far smaller concern than against a password.

It is recorded here because a deprecated cipher is exactly the code nobody re-reads, and the next
person to consider un-deprecating it should meet this sentence before they do. **It is not a claim
of a vulnerability** — no exploit was constructed and none is asserted.

## AMENDED 2026-09-21, the same day — the scoping in the section above was wrong

That section recorded the secret-derived salt and scoped it as "a far smaller concern than against
a password", on the strength of the secret's entropy. B-215 argued it better and the measurement
agrees: the exposure is not the cost of guessing a secret, it is that a salt derived from the
secret has no per-DEPLOYMENT uniqueness at all. One precomputed table over likely secrets is valid
against every deployment simultaneously, whatever each secret's entropy — which is the property a
salt exists to provide, and NIST SP 800-132 § 5.1 requires it be independent of the secret for this
reason.

The section is kept unedited above as the record of what was believed this morning. It said "no
exploit was constructed and none is asserted", and that remains true; what was wrong was the
comparison it used to size the concern.

Fixed in `d24fb08b2`: the salt is an optional second argument, and omitting it keeps the old
derivation — so existing ciphertext still decrypts — while warning once per process.

## What this ADR does NOT settle

Whether the action pipeline should encrypt its payloads. See *What was rejected*.

## Verification

`tests/unit/a-zero-consumer-subpath-carries-its-deprecation.test.ts` asserts that every
`@theokit/http/*` subpath `docs/program/capability-matrix.md` records as having no consumer carries
a `@deprecated` in the file the matrix names. It fails on a matrix row added tomorrow and left
undecided, which is the state this ADR and ADR 0007 both exist to end.
