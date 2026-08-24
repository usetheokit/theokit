# Surface measurements

One file per surface of the framework, sixteen in all, each named after the specialist that reads it
(`observability.md` is what `observability-specialist` reads). Each answers three questions about its
surface and cites `file:line` for every answer: **what exists** today, **how strong it is**,
and **what is missing** against the field.

These are measurements, not plans. The schedule lives in `ROADMAP.md`; the maintenance registry lives
in `BACKLOG.md`. A file here says what the code does on the day it was read, and every one of them
says "re-measure before trusting" for the reason that follows.

## This copy is the authoritative one

The same sixteen files exist under `.claude/skills/*/references/theokit-gap.md`. That is the local
mirror — the specialists load their reference from that path, so the copy has to be there for the
tooling to work. It is a mirror all the same.

`.gitignore:84` ignores `.claude/` in full. A measurement that lives only there is on one machine,
readable by one person, auditable by nobody, and invisible to CI. The program goal asks for work
delivered "with the `theokit-gap.md` re-measured", which is a claim no reviewer could check while the
evidence was untracked. Versioning it here is what makes the claim contestable.

**When the two copies disagree, this one is right.**

## Two copies can drift, and that is a defect

Nothing keeps these sixteen files in step with the sixteen under `.claude/`. Editing one and not the
other produces two measurements of the same surface that quietly disagree, and no gate notices.

`B-008` in `BACKLOG.md` registers this exact failure for a different artifact — the domain routing
table, where the authoritative copy is gitignored and a second copy drifts silently. Its Definition of
done is the general rule: *"exactly one copy is authoritative, and the script reads that one — a
second copy that drifts silently is the failure being fixed, not an acceptable cost."* The same
sentence applies to these files, and until it is resolved the discipline is manual:

**Never edit one copy. Edit both, in the same commit, or neither.**

`docs/README.md` records the same arrangement for `.claude/rules/`, and is honest in the same way
about it being unsolved.

## Measured 2026-08-20, and why they were re-measured

Every file here was read against the code on 2026-08-20. The trigger was the previous pass: on
2026-08-19, **eleven of the sixteen came back materially wrong** — capabilities listed as missing that
exist, and capabilities listed as present that are dead code. The section "The gap files are not
evidence" in `ROADMAP.md` records what that would have cost: a roadmap built on them would
have scheduled the reimplementation of finished work and declared finished what was never built.
No roadmap criterion cites a gap file for that reason.

The 2026-08-20 pass is not a claim to be correct. It is a claim to have been read against the code,
with a `file:line` on each row so the next reader can check a row instead of trusting the file.
Several of the files carry an explicit "corrections to the 2026-08-19 version" section, which is the
mechanism working rather than an embarrassment.

## What versioning them changes: they are now gated

`scripts/check-doc-citations.mjs` verifies that every citation written as a path followed by a colon
and a line number still names a file that exists, at a line inside it. Its `collectDocs` walker skips any directory whose name starts with
a dot, except `.github`:

```js
if (entry.name.startsWith('.') && entry.name !== '.github') continue
```

So for as long as these files lived only under `.claude/`, **not one of their citations was ever
checked by any gate** — the guard walked straight past them. Under `docs/` they are in scope, and the
725 citations they carry are verified on every run.

That is the point of moving them, and it is also why the gate can fail on a run that touches them:
a citation that rots here now fails CI, where before it rotted in silence. If it does fail, the fix is
to open the file and find the real target, or to rewrite the sentence without a `file:line` when the
target no longer exists. Inventing a path that resolves defeats the entire instrument.
