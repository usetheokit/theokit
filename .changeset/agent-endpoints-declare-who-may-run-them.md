---
'create-theokit': patch
'theokit': patch
---

An agent now declares who may run it, and every endpoint it exposes obeys that declaration.

An agent file exports a `policy` — the string `'public'`, or a function over
`{ subject, body, params }` — and the run endpoint, the thread routes, the pending-approval listing,
the approve route and MCP all evaluate it, through the same function the route executors and the
in-process caller use. `params` carries `{ agent, endpoint, sessionId?, approvalId? }`, so one
declaration can answer the endpoints differently. `requireOwner` is the primitive for the owner
check, the same one routes use.

Identity comes from `ctx.subject`, produced by the application's own `server/context.ts`. That seam
is the one every `route()` already reads and no agent URL ever reached: the agent endpoints are
dispatched before route matching, so no route, no `server/middleware/` and no `server/context.ts`
observed those URLs, and the endpoints resume the conversation the caller names. The check runs
before the module is compiled and long before the SDK — an agent run spends real tokens, so a caller
who may not run it is turned away before any of that is paid for.

**Breaking.** The agent scanner refuses a file under `agents/` that declares nothing, so
`theo build`, `theo start` and `theo dev` fail until each agent says something. The error names the
file, the URL it serves and the two ways out. This is the same gate the route scanner applies, and
absence had to stop meaning open here for a sharper reason than it did there: no runtime default is
both safe and non-breaking, because refusing every caller-supplied session id breaks multi-turn chat
and admitting them is the defect. `'public'` is still an answer — it says out loud that the app runs
a capability model, where holding an id is the whole of the permission. Nothing changes for an agent
module built in memory and handed to `mountAgent` directly; that value never passes a scanner.

Also breaking: `GET /api/agents/<name>/approvals` is gated by the same declaration and 404s for an
agent that does not exist, and a refusal from any agent endpoint no longer repeats which check
refused it — the wire gets one fixed message naming what to supply, and the reason goes to the
server log.

The scaffold's agent declares `export const policy = 'public'`, with the owner check written out
above it. `MIGRATION.md` has the guide.
