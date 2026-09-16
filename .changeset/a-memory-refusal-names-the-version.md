---
"@theokit/agents": patch
---

Documents that a subagent's `memory:` declaration needs `@theokit/sdk@5.9.0`, and pins it
with a test.

`applySubagentMemory` shipped in 14.5.0 reading a declaration the SDK parses off subagent
frontmatter. Before 5.9.0 that parse REFUSES the key — measured against the published
tarballs, with a control that declares no `memory:` and loads on both:

    5.3.0   ConfigurationError: Subagent note-taker.md: unknown frontmatter field "memory"
            (accepted: name, description, model, tools, reasoning_effort, mcp, sandbox)
    5.9.0   loads both; `memory: "project"` survives

The failure was never silent. What misleads is where it points: naming the field reads as a
typo, so the line an author meant to write gets deleted instead of the SDK upgraded.

**The range is unchanged at `^5.3.0`, and there is no runtime guard.** Both were tried and
both were refused by gates that were right. Raising the floor is refused by
`the-declared-sdk-range-delivers-what-the-code-assumes.test.ts`, which holds that a gap
announcing itself is guarded rather than closed by the range — closing it strands every
consumer, including those who never write `memory:`. A guard is refused by the bundle
budget: wiring one into `listSubagentNames` cost **161 bytes** of a root barrel with 72 of
headroom, and the cost is the COUPLING rather than the code — four different bodies produced
byte-identical bundles, and a dedicated module was worse at 40 403 because it duplicated
`createRequire`.

So the requirement is documented where someone hits it, and a test fails if it stops being
true. `applySubagentMemory` itself needs no particular SDK: it reads `node:fs`, takes an
object, and works on any version — the requirement belongs to the parser.
