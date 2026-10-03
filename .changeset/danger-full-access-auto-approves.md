---
"@theokit/agents": minor
---

`shouldAutoApprove` lets `full-auto` run under `sandbox_mode = "danger-full-access"`

The rule was "nothing auto-approves without enforced confinement", read from `posture.enforced`. The
SDK reports `danger-full-access` as `enforced: false`, because that mode is the operator asking for no
sandbox, so `full-auto` under it was refused on every machine and the mode could never take effect
without a human. Codex runs the same combination unconfined.

The waiver is read from `posture.mode`, which the SDK sets from configuration and never from
detection. A `workspace-write` session whose bwrap fails to start still reports `workspace-write` and
is still refused. `suggest` and `auto-edit` are unchanged. `applyPosture` accepts an `auto-approve`
posture whose `confinedBy` is a `danger-full-access` posture, and its refusal message for any other
unenforced posture names that mode as the way to run unconfined on purpose.

The `posture` parameter now also accepts an optional `mode`. Callers that pass only `{ enforced }`
keep the old answer. (#939)
