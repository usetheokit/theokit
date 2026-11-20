---
'theokit': minor
'@theokit/agents': minor
---

Pending `@HumanInTheLoop` approvals can now survive a restart and be answered from another instance. `createFileApprovalStore(dir)`, `createDurableApprovalRegistry(store)` and `configureApprovalRegistry(registry)` are exported from `theokit/server/agent`; with a durable registry a gated call is recorded and the run ends deferred, and `POST /api/agents/<name>/approve/<id>` resumes the session with the decision (an expired record is settled by its `onTimeout`, an unknown `schemaVersion` answers 409). The in-process registry stays the default. `@theokit/agents`: `streamAgentUIMessages` accepts `hitl.onDefer` and `toolDecisions`, and the HITL plugin does not gate a call a person already approved on resume.
