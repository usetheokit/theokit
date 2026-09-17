---
'@theokit/agents': patch
---

Every text-bearing channel a client receives now reflects the declared output guards.

`DoneEvent.result` was not moderated: with a redactor declared, one turn delivered `text_delta ->
"here: [R]"` and `done.result -> "here: sk-abc123"`, so a client rendering the terminal frame got the
secret the guard existed to remove. It is now rebuilt from the round's own moderated deltas — which is
exact rather than approximate, because the frame carries the visible text of its own round.

`task_progress.text` — the fourth channel — takes an ordinary third `moderateOutputStream` pass on
both the runner and the served path. It is not a mirror of anything: it carries text the model writes
through `task-tools`, and a milestone naming a secret is the same disclosure as a delta naming it.
