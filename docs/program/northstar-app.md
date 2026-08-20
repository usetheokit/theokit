# The North-Star Application

Source of Truth for the validation application that exercises the framework end to end. Declared by the project owner on 2026-08-19.

It is not a product, not an example, and not a test fixture. It is the one application whose job is to prove — by being used — that the framework does what it claims, across every target it claims to serve.

## Shape

```
backend  →  presenter  →  ┬─ Web
                          └─ TUI
```

One backend. One presentation layer. Two front-ends rendering the same runs. That shape is the point: if the same agent run renders correctly in a browser and in a terminal, through the same presenter, then `three-target-parity.md`'s core/presentation split is **proven** rather than asserted. If it only works in one, the split leaked, and the app is what tells us.

`packages/presenter` already ships `json`, `terminal` and `ui-message-stream` presenters. The app consumes them; it does not fork them.

## Not versioned — and what that costs

The application source is **not committed**. It is disposable and regenerable, and versioning it would make a validation harness into a maintenance obligation and mix it into the framework's release surface.

That decision has a real cost, and it is paid deliberately rather than ignored: an uncommitted app cannot run in CI, cannot be reproduced by a second person, and leaves no diff when it breaks. Left there, "we validated 100% of the capabilities" would be a claim nobody can check — the exact failure mode the rest of this system exists to prevent.

So the split is:

| Artifact | Versioned? | Why |
|---|---|---|
| The app's source | **No** | Disposable, regenerable, not a product |
| The **capability matrix** it must exercise | **Yes** | Otherwise "100%" is unfalsifiable |
| The **evidence** each run produces | **Yes** | It is the proof, and proof that lives only on one machine is not proof |

The app is regenerated from the matrix. The matrix and the evidence are what an auditor reads.

## Location

`northstar/` at the repository root, gitignored and declared a pnpm-workspace member — the mechanism `my-test/` already uses (`.gitignore:93`, `pnpm-workspace.yaml`). Being a workspace member is what makes it link `workspace:*` against the local packages instead of the published ones, which is the whole point: it must exercise **our** source, never what npm happens to serve.

## The capability matrix

`docs/program/capability-matrix.md` — versioned, derived from the framework's own public surface (the `exports` map of every package, the reserved route filenames, the reserved agent folders, the config schema, the adapter registry, the presenters). Every row states the capability, where it lives, and how the app exercises it.

A capability absent from the matrix is a capability that will never be validated, so the matrix is generated from the code rather than written from memory, and re-derived whenever the public surface changes.

## What a failure means

The app is allowed — expected — to fail. Several shipped capabilities have no production caller (`initCacheEngine`, `createObservabilityPlugin`, `trackAgentRun`, `csrf-multi-header`, `action-encryption`). An app that tries to use them and cannot **is producing the correct result**, and that result is evidence, not a bug in the app.

Recording those failures is the point. An anchor scenario that only ever passes is theatre — `dogfood-golden-rule.md` § 4 already requires at least one failure story, for exactly this reason.

## Relationship to the existing gates

- **This app is the anchor scenario** that `rules/dogfood-golden-rule.md` § 1 has been waiting for. `docs/program/dogfood-manifest.md` does not exist yet, so `/dogfood` currently emits `anchor_missing` and refuses every production claim. Declaring this app as the anchor is what unblocks that gate honestly.
- **It is an instrument of `cycle-acceptance`, not a replacement for it.** Acceptance exercises the *released* artifact against a milestone's Definition of done. The north-star app runs continuously against the working framework. Both are needed: one proves a milestone shipped correctly, the other catches the regression before it ships.
- **Its evidence lands in `docs/program/evidence/`** with the frontmatter § 5 mandates (`scenario`, `date`, `operator`, `outcome`, `summary`). Evidence without that frontmatter is ignored by the gate.

## Anti-patterns

- **Letting the app drift into a product.** The moment it grows features nobody is validating, it stops being an instrument and becomes a second thing to maintain.
- **Fixing the app to make a capability pass.** If the framework cannot do it, the app must fail. Papering over that inverts the instrument.
- **Claiming coverage from the matrix rather than from evidence.** A row in the matrix says what *should* be exercised; only an evidence file says what *was*.
- **Committing it "just this once".** It is gitignored on purpose; an accidental commit makes the framework's release surface include its own test harness.
- **Building only the Web front-end.** Then the app validates one target and the three-target rule goes unproven — which is the specific thing it exists to prove.

## Cross-references

- Three-target constraint this proves: `rules/three-target-parity.md`
- Honesty gate this unblocks: `rules/dogfood-golden-rule.md`
- Per-milestone validation of the released artifact: `rules/cycle-acceptance.md`
- Presentation adapters it consumes: `packages/presenter/src/presenters/`
- Scratch-app precedent it follows: `.gitignore:93`, `pnpm-workspace.yaml`
