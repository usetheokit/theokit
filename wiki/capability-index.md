---
type: reference
title: Capability index — which symbol delivers what, and when it landed
---

# Capability index

**The question this page answers:** *"I need X — does TheoKit already have it, and since when?"*

Every other index in this wiki is organised by topic or by package. Someone building an agent app
does not search that way. They search by need — *"I want session GC", "I want a tool registry", "I
want credential resolution"* — and if the answer is not one lookup away they build their own.

That is not a hypothesis. The 2026-08-14 cross-validation against TheoCode measured five capabilities
that had **already shipped** and were being reimplemented downstream anyway, because nothing
connected the need to the symbol. This page is the missing connection.

## How to read a row

- **Capability** — the need, phrased the way someone searching would phrase it.
- **Symbol** — what to import. Every symbol here resolves in the published `.d.ts`; a row citing a
  symbol that does not exist is a defect, and `tests/integration/crossval-gaps.test.ts` fails on it.
- **Import from** — the subpath. The package barrel is not the API.
- **Landed** — the version a consumer needs at minimum.

## Agent runtime and composition

| Capability | Symbol | Import from | Landed |
|---|---|---|---|
| Author an agent with a fluent builder | `AgentBuilder.create` | `@theokit/agents` | 8.x |
| Author a tool with a Zod schema | `Tool.create` | `@theokit/agents` | 8.x |
| Drive an agent turn and read its events | `createSdkAgentStream` | `@theokit/agents/bridge` | 8.x |
| Inspect what an agent compiled to, in a test | `inspectCompiled` | `@theokit/agents/testing` | 8.x |

## Tools, scope and sandbox

| Capability | Symbol | Import from | Landed |
|---|---|---|---|
| Register tools and resolve them by name | `Toolset` | `@theokit/agents` | 7.x |
| Bind `{projectRoot, writeRoot, sandbox}` once so an unconfined shell is unrepresentable | `bindToolScope` | `@theokit/agents/tool-scope` | 8.x |
| Ask what a sandbox mode is allowed to write | `sandboxWritePolicy` | `@theokit/agents/tool-scope` | 8.x |
| Built-in file, git, search and shell tools | `createReadFileTool` | `@theokit/agents/tools` | 7.x |

## Credentials and trust

| Capability | Symbol | Import from | Landed |
|---|---|---|---|
| Decide which credential to use, and record where it came from | `resolveCredential` | `@theokit/agents/auth` | 8.x (M79) |
| Refuse a credential store that others can write | `assertSecureModes` | `@theokit/agents/auth` | 7.4.0 |
| OAuth device flow (RFC 8628) and refresh under a cross-process lock | `AuthProvider` | `@theokit/agents/auth` | 7.4.0 |
| Persist an "always allow this tool" grant across processes | `PermissionStore` | `@theokit/agents/auth` | 9.x |
| Layer config, resolve trust posture, walk an instruction tree | `LayeredConfig` | `@theokit/agents/config` | 9.x |

## Sessions

| Capability | Symbol | Import from | Landed |
|---|---|---|---|
| Collect old transcripts without deleting a live one | `runTranscriptGC` | `@theokit/agents/session` | 8.x |
| Refuse a retention knob below its floor | `GCFloorError` | `@theokit/agents/session` | 8.x |
| See what a GC run would delete before it deletes it | `GCCandidate` | `@theokit/agents/session` | 8.x |
| Know which transcripts must never be collected | `protectedTranscripts` | `@theokit/agents/session` | 8.x |

## Human in the loop

| Capability | Symbol | Import from | Landed |
|---|---|---|---|
| Let the agent ask the operator a question and settle it safely | `createAskBridge` | `@theokit/agents/ask` | 8.x |
| Track questions awaiting an answer without double-settling | `createPendingLedger` | `@theokit/agents/ask` | 8.x |
| Refuse to run a repo hook whose command changed after approval | `hookFingerprint` | `@theokit/agents/hooks` | 8.2.0 |

## Errors

| Capability | Symbol | Import from | Landed |
|---|---|---|---|
| Catch every framework error with one `instanceof` | `TheokitAgentError` | `@theokit/agents` | 8.x |
| Distinguish a toolset misconfiguration from any other failure | `ToolsetError` | `@theokit/agents` | 8.0 |

## Honest gaps

Recorded here rather than omitted — a capability index that lists only wins teaches people to trust
it and then surprises them.

| Need | Status |
|---|---|
| A durable, multi-process approval registry | Not shipped. The registry is in-memory and single-process **by declaration**, not by accident |
| MCP OAuth client flow | Type-only today (`McpOAuthConfig`); no implementation in `packages/` |

## Keeping this page true

Two mechanisms, because a stale index is worse than none:

1. `tests/integration/crossval-gaps.test.ts` asserts every symbol cited here resolves in the
   published `.d.ts`.
2. `scripts/check-surface-parity.mjs` fails CI when the layer stops forwarding an SDK symbol — which
   is how capabilities went missing without anyone noticing in the first place.
