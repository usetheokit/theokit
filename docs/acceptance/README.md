# Acceptance records travel; the rest of the trail does not

This is the one directory under `.squad/records/` that git tracks, and the exception is argued
rather than convenient.

Everything else here — plans, alignment briefs, audits, reviews, the event stream — is **one
machine's run history**. What this checkout's cycles did says nothing to whoever clones it, and
committing it would put one operator's working notes in everybody's diff. `.gitignore` keeps it out
for that reason, copying the arrangement the kit uses on its own repository.

An acceptance record is a different kind of thing. It is the evidence that a milestone was exercised
**against a released artifact** — the answer to *"was this ever actually used before we called it
done?"* — and an answer only one machine can read is not an answer. `cycle-acceptance` calls the
record "the artifact an auditor reads"; an auditor is by definition not at this keyboard.

## What this directory held before, and does not now

The first acceptance run of this programme wrote `M1-2026-08-20.md` plus sixteen evidence files into
`.claude/knowledge-base/acceptance/`. `.claude/` is gitignored, so none of it reached anyone — and by
2026-09-18, when B-020 came to be closed, **none of it existed at all**: not under that path, not
under `records/acceptance/`, nowhere in the tree. The item warned that the evidence was unreadable
off this machine; what actually happened is that it stopped being readable anywhere.

That is why this file exists rather than a `.gitkeep`. A directory that is empty because nothing has
run yet and a directory that is empty because its contents were lost look identical, and the second
is worth writing down.

## What lands here

`records/acceptance/{milestone-id}-{YYYY-MM-DD}.md` plus an `evidence/` directory beside it, per
`cycle-acceptance § Output`. The record carries `verdict:` in its frontmatter — that line is what any
reader, human or script, resolves to decide whether the milestone closed.
