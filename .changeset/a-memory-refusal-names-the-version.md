---
"@theokit/agents": patch
---

An SDK too old for `memory:` now says so, instead of reporting an unknown frontmatter field.

`applySubagentMemory` shipped in 14.5.0 reading a `memory:` declaration the SDK parses off
subagent frontmatter. Before `@theokit/sdk@5.9.0` that parse REFUSES the key — measured
against the published tarballs, with a control that declares no `memory:` and loads on both:

    5.3.0   ConfigurationError: Subagent note-taker.md: unknown frontmatter field "memory"
            (accepted: name, description, model, tools, reasoning_effort, mcp, sandbox)
    5.9.0   loads both; `memory: "project"` survives

The failure was never silent. What was wrong is where it pointed: naming the field and the
accepted keys reads as a typo, so the line an author meant to write gets deleted instead of
the SDK upgraded. `listSubagentNames` now replaces exactly that refusal with one naming
5.9.0 and the upgrade, and leaves every other error untouched.

**Not a floor bump, and the range is unchanged at `^5.3.0`.** Raising it was tried first and
reverted: this repository already decided that a version gap which announces itself is
guarded rather than closed by the range, because closing it strands every consumer —
including those who never write `memory:` — to duplicate a refusal they would already have
received. The gap simply was not announcing itself usefully, which is what this fixes.
