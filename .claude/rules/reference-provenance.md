# Reference Provenance

Source of Truth for how third-party study material is kept OUT of this project.
`knowledge-base/references/` holds cloned peer projects (inspiration) and
`knowledge-base/tools/` holds tools we depend on. Both are read-only: we read them
to learn, and we write our own code. A literal copy carries the original licence
into this repository, which is a legal problem, not a style one.

## § 1 — The zone

`knowledge-base/references/**` and `knowledge-base/tools/**` (also valid under a
`.claude/` prefix). Never versioned — `.gitignore` excludes both.

## § 2 — Four layers, four different guarantees

| # | Layer | Guarantees | Where |
|---|---|---|---|
| 0 | Write-in guard | Nothing is written INTO the zone (it stays pristine study material) | `hooks/boundary-check.sh`, `validate-command.sh`, `settings.json` deny |
| 1 | Export guard (P1) | Content does not leave the zone by command — `cp`/`mv`/`rsync`/`scp`/`tar`/`dd`, `>`/`>>` redirect, `\| tee` | `hooks/validate-command.sh` |
| 2 | Commit-message guard (P2) | The public history never cites a zone path | `hooks/validate-command.sh` |
| 3 | Leakage detector | Detects the RESULT of a manual paste: a block of consecutive lines shared with a zone file | `scripts/check_reference_leakage.py`, wired into `hooks/stop-validation.sh` |

Layers 0–2 are **blocking** (exit 2). Layer 3 is **advisory** (WARN): exact-shingle
matching is strong evidence, not proof, and a false BLOCK on a heuristic is worse
than a WARN — shared boilerplate and a common upstream both produce real matches.

## § 3 — What stays allowed, deliberately

Reading, grepping, listing and opening zone files. That is the entire purpose of
the zone. What is forbidden is duplicating its bytes into the project or into the
git history. The intended path from study to code is:

```
read the zone → understand → write your own version
              → record the finding in knowledge-base/discoveries/blueprints/, citing the source
```

## § 4 — Limits, stated honestly

- Layer 1 sees commands, not editors. An agent that reads a zone file and *retypes*
  its content is invisible to it — that gap is exactly why layer 3 exists.
- Layer 3 compares changed project files against the zone. It cannot detect a copy
  from a project that was never cloned into the zone, and it will not fire on a
  paraphrase — only on near-literal text (whitespace and case are normalized).
- Layer 3's zone scan is capped (`--max-zone-files`, default 5000) because the zone
  can hold tens of thousands of foreign files. When the cap truncates a run, the
  output says so — coverage is reported PARTIAL, never silently claimed complete.
- Layer 2 matches the full zone path, so ordinary words like "cross-references" are
  untouched. A commit that describes a technique in prose, without the path, passes —
  by design: attribution in the CHANGELOG is welcome, a path into third-party code
  in the public history is not.

## § 5 — Anti-patterns

- Copying a zone file "just to adapt it later" — adaptation of a copy is still a
  derivative work. Write it yourself.
- Recording provenance by pasting the zone path into a commit message. Put the
  source and licence in `CHANGELOG.md` and the blueprint instead.
- Dismissing a layer-3 WARN without opening the match. It is advisory precisely so
  a human decides; ignoring it defeats the layer.
- Using `.references-bootstrap` for anything but the initial population of the zone,
  or leaving the marker in place afterwards.

## Cross-references

- Git safety and branching: `git-safety.md`
- Hooks: `../hooks/validate-command.sh`, `../hooks/boundary-check.sh`, `../hooks/stop-validation.sh`
- Detector: `../scripts/check_reference_leakage.py`
- Cycles that cite this: `cycle-discover.md`, `cycle-review.md`
