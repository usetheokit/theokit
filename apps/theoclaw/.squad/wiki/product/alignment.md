# Product alignment — theoclaw

## Reviewer sign-off

- [x] The problem stated in the vision is the real one  <!-- signed-by: human/paulo -->
- [x] These are the right objectives, and the metrics are the right metrics
- [x] The requirements follow from the objectives
- [x] The pieces cover every requirement

<!-- signed-by: -->

---

## What these four boxes cover that the score does not

`score_product_alignment.py` reports 100% and then names three things it cannot decide:
whether the stated problem is the real one, whether these are the right objectives, and
whether these are the right metrics. **These boxes are those three, plus coverage.** The
number and the checklist together mean something neither means alone.

## What is being signed, as of 2026-09-18

| document | contents |
|---|---|
| `product-vision.md` | open-source self-hosted assistant, competitor to OpenClaw and Hermes, whose purpose is also to demonstrate theokit; two problems; three non-goals; why now = the competitive window |
| `objectives.md` | **6 objectives**, each with a metric containing a number and a horizon |
| `trd.md` | **9 requirements**, each citing the objective it serves |
| `technical-pieces.md` | **10 pieces**, each citing the requirements it realises |

Each of the four already carries its own `## Sign-off`, and all four were signed by Paulo
on 2026-09-17/18. **This document is separate and is the one the gate reads** — the
per-document boxes record agreement with each document's own claims; these four record
agreement that the cascade holds end to end.

## What a signer should know before ticking

Three things changed late, after the first three documents were written:

1. **OBJ-6 was added on 2026-09-18** and it is the one that says what the product DOES —
   derived from Hermes' seven headline capability rows at Paulo's direction. It puts
   autonomy and self-authored skills back **in scope as capabilities** after both were
   declined as *problems*. That reversal is deliberate and is written in the objective.
2. **REQ-9 and PIECE-10** followed from it: unattended scheduled work is a first-class
   path, and no piece covered it before.
3. **REQ-8 gained a second half** — exact pinning without an audit is a policy that ages
   into the thing it protects against, measured as 12 known CVEs in a same-day install of
   the product that wrote the policy.

## What no signature here asserts

That any of it was verified. The reference notes under `.squad/wiki/references/` record
what was measured against Hermes and what was not; the boxes above record only that a
person read this cascade and is willing to say it holds.

**Signed 2026-09-18 by `human/paulo` — a person, not a judge.**

What a signature asserts is that someone read this and is willing to say it holds. It does not assert that a machine checked it: the deterministic score sits above, and the two are separate claims on purpose.
