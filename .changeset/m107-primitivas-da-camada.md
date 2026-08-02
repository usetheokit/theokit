---
'@theokit/agents': minor
---

Two additions: `loadMcpJson(cwd)` reads the `.mcp.json` project convention from disk, and `reasoningEffortOf(model)` reads back the reasoning effort that `buildModelSelection` writes.

**`loadMcpJson(cwd)`** — the layer already shipped the rare MCP cases (`resolveMcpServers` for per-request selection, `mcpRegistry` for a known provider) and not the common one: reading `<cwd>/.mcp.json`, the convention Claude Code and Cursor established. Every application that wanted it wrote the loader by hand, which is why the same 120-odd lines of read-parse-validate exist in more than one consumer.

It returns the `McpServersMap` the package already exports — no new type. An **absent** file returns `{}`, because MCP is opt-in and a project without the file is a project without MCP. A **present but broken** file throws `McpFileError` naming the path: a read failure, invalid JSON, a root that is not an object, a server without a non-empty `command`, or an `args`/`env`/`cwd` of the wrong type. A valid JSON object with no `mcpServers` key returns `{}` — that is a project declaring no server, not a malformed file. An empty (0-byte) file is invalid JSON and throws, deliberately: "absent" and "present and empty" are different situations, and treating the second as `{}` would disable MCP in silence.

`McpFileError` descends from `TheokitAgentError`, so `isTransientError` classifies it like every other error from this package (`isRetryable` is `false` — a malformed config file does not improve on retry).

**Scope, so it is not a surprise later:** stdio servers only. HTTP/SSE entries are not accepted in this release. Widening it later is additive and breaks nothing written against this version.

**`reasoningEffortOf(model)`** — the inverse of `buildModelSelection`, which is documented as the single site that maps a reasoning effort onto a `ModelSelection`. Only the write half was public, so callers that needed to read the effort back re-derived the parameter key by hand. Two spellings of one key drift apart quietly; now both directions live in one module and share one constant.

It accepts a bare model id or a full selection, and returns `undefined` when there is no effort to read — a string id, a selection without parameters, or parameters that do not include the reasoning key. None of those throw: absence is a normal answer, not a failure. A value that is present but not one of the documented levels comes back **verbatim**, and the return type is `string | undefined` for exactly that reason: validating the value stays with the caller, and typing the result as the effort union would promise a check this function does not perform.

Both symbols are reachable from the package root and from `@theokit/agents/bridge`.
