---
"@theokit/agents": major
---

The declared `@theokit/sdk` floor now carries the `memory:` frontmatter field that
`applySubagentMemory` reads.

`14.5.0` shipped a function reading `AgentDefinition.memory` while the package went on
declaring `^5.3.0`. Measured against the published tarballs on 2026-09-16, with a control (a
second subagent declaring no `memory:`, which must load on both):

    5.3.0   ConfigurationError: Subagent note-taker.md: unknown frontmatter field "memory"
            (accepted: name, description, model, tools, reasoning_effort, mcp, sandbox)
    5.9.0   loads both; `memory: "project"` survives the parse

The issue that prompted this described the failure as the function silently doing nothing.
It is worse: at the declared floor the subagent does not load AT ALL, and the error names a
field its author wrote deliberately — a reader would reasonably conclude their frontmatter
is wrong rather than their SDK too old.

**Why major, and what it actually costs you.** The same call was made for the same
dependency in `fix(deps): stop declaring an SDK floor that delivers no parity`, which cut
`^4.52.1 || ^5.0.0` down to the 5 line; deciding a resembling case the same way is the rule,
and diverging needs a measured reason rather than an estimate of impact. The honest estimate,
stated so nobody has to guess: this narrows WITHIN the 5 line, so a consumer whose own range
is `^5.x` already resolves 5.9.0 and sees nothing. Only a pinned `5.3.0`–`5.8.x` has to move,
and it moves by a minor.

A test carries the requirement rather than a comment on the range: it loads a subagent
declaring `memory:` against whatever SDK is installed, so `dep-check`'s floor run — which
installs the declared floor and runs the suite — fails if the range is ever lowered again.
