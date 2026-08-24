---
'@theokit/agents': patch
'theokit': patch
---

A human-in-the-loop tool call is one call on the wire again. A `@HumanInTheLoop` tool used to cross
as TWO `tool-input-available` chunks under two different `toolCallId`s — the approval id the HITL
plugin mints for its `approve/${approvalId}` callback, and the runtime tool-call id the SDK mints
when it dispatches the tool. Neither producer can adopt the other's id: the SDK's `pre_tool_call`
context carries `name`, `args`, `agentId` and `runId` and no call id at all, so the plugin has
nothing to key on, and the approval has to be published before the tool exists.

The translator correlates them now, so one logical call is announced once and its result carries the
same id. `tool-approval-request` keeps the plugin's id in `approvalId` — the callback URL is
unchanged and the same value still resolves the pause — and names the call it gates in `toolCallId`,
which is what that field was always for.

What this was costing: a consumer counting tool calls counted two, a UI grouping blocks by
`toolCallId` rendered two cards for one call and left a permanently pending approval part next to the
completed one, and the `agent.hitl` observability span opened on the approval id was never closed by
a result arriving under the runtime id — so its duration approximated the whole run instead of the
human's wait. That span now closes at the resume and carries `hitl.resume_observed: true`; the
end-of-run sweep that marks the opposite is back to being the exceptional path it describes, reached
when a pause genuinely never resumes (the client disconnected, the run failed mid-pause).

Ungated tools are untouched — the correlation is identity for a call no approval ever claims.
