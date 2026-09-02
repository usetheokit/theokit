---
'@theokit/agents': patch
---

**When the model types `[tool call] NAME`, say whose marker it is** (#631).

A consumer saw an assistant message reach `agent.thread` as
`"…report its output.[tool call] run_shell"`, with no `tool_use` part in it, read it as the model
misbehaving, and changed the prompt. No prompt was ever going to fix it.

Read from the published `@theokit/sdk@4.63.3` tarball, the chain is: a resumed send hydrates the
session; hydration narrows each stored message to BOTH projections — `text`, in which a tool call
folds to `[tool call] NAME`, and the structured `parts`; and the replay then builds the model's
history from `text` alone (`content: [{ type: 'text', text: msg.text }]`, with `msg.parts` read
nowhere in that bundle). So the model's own history shows it the marker, and it does the reasonable
thing with a pattern it is shown — it writes the marker instead of calling the tool. Filed upstream
as usetheodev/theokit-sdk#523.

The bridge now emits ONE warning naming the SDK, the resumed session, the fact that the call did NOT
run, and both issue numbers. **The text is not touched.** Stripping the marker would leave a message
describing an action that never happened — a visible defect turned into an invisible one, which is
the swallowing this project's error-handling rules forbid. The fix belongs upstream; what belongs
here is that nobody else spends an afternoon in a bundle to find that out.

Also covered by a new test: a text block and a `tool_use` block in ONE message — the shape reported,
and the one case the translator suite had no test for — travels `translateSdkEvent` →
`presentUIMessageStream` → `readMessageStream` and arrives as two structured parts.
