# `@theokit/agents`

The layer between `@theokit/sdk` and an application that hosts an agent.

The SDK is the **runtime** — it calls the model, dispatches tools, stores the conversation, streams
the response. This package is the **home**: the surfaces an app needs around that runtime — where
credentials come from, which tools are in scope and under what sandbox, when a human is asked, what
happens to a session after it ends.

The division is not stylistic. `@theokit/agents` never re-implements a runtime concern; when it
looks like it does, that is a bug. What it does is **enrich**: adding the object-shaped surface where
there is state or orchestration to hold, and forwarding the rest unchanged.

> **Enriching never reduces.** A symbol the SDK exposes and this layer does not forward is
> unreachable to whoever consumes the layer — and the only legal way out for them is to reimplement
> it. That happened: when `./auth` exported one value against the SDK's nineteen, a downstream
> product rewrote ~120 lines of credential mechanics in the
> repository root now requires a written decision per SDK symbol, so the next gap breaks CI instead
> of quietly costing someone a week.

## Install

```bash
pnpm add @theokit/agents
```

Peer dependencies: `zod` (schemas), `react` (only for `./client/react`), `@theokit/http` (only when
you mount HTTP surfaces).

## Subpath map

Twenty-five entry points. Import the one you need — the barrel is not the API.

| Subpath          | What lives there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.`              | `AgentBuilder.create()` — the authoring surface — plus the error hierarchy and shared types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `./bridge`       | The SDK seam — `createSdkAgentStream`, event translation, the agent builder internals, `ERROR_CODE_DATA_PART`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `./control`      | `createSessionStore`: named sessions, one agent and one turn at a time each, with interrupt and steer; `createDevicePairing`, `pairRoute` and `redeemPairing`: setup-code device pairing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `./mcp-relay`    | `createMcpRelayServer` and `startMcpRelayConnector`: a hosted MCP client reaches a local agent's tools through a long-polling relay, with no open port, filtered by each grant's scopes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `./testing`      | Test seams: compiled-agent inspection, mock streams, the live-suite provider-key guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `./sandbox`      | Sandbox backends, postures, `sandboxWritePolicy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `./persistence`  | Transcript storage primitives forwarded from the SDK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `./interactive`  | The interactive-shell backend contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `./pty`          | The node-pty implementation of that contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `./auth`         | Credential store, OAuth/device flow, `resolveCredential`, `assertSecureModes`, `RefreshFailure`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `./config`       | Agent configuration, trust posture, and the instruction tree (`loadInstructionTree`); `defineAppBootstrap` runs one setup from every entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `./tools`        | Built-in tool factories (read, list, grep, git, patch, edit, shell, …)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `./client`       | Transports for driving an agent from a client. `AgentClient.sendAndWait(input)` resolves when that turn settles (`done`/`error`/`aborted`, never rejects), and `asGoalLoopAgent(client)` adapts a client to the SDK `GoalLoopAgent` so `runGoalLoop` can drive it without polling. `AGENT_ACTION_HEADERS` and `agentRequestHeaders(...)` give a plain `fetch` the headers the route requires                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `./client/react` | `useAgent` and the React bindings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `./session`      | Session lifecycle, listing, fork/rewind, transcript GC with a retention floor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `./hooks`        | The lifecycle-hook engine and its fingerprint gate; `parseClaudeHooks` reads the Claude Code hook dialect (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `./ask`          | The human-in-the-loop rendezvous — ask a question, settle it, abandon it safely                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `./tool-scope`   | `bindToolScope` — bind `{projectRoot, writeRoot, sandbox}` once so an unconfined shell is unrepresentable. `protectedPaths` (absolute, or relative to `projectRoot`) lists state directories tools must not touch; `createPathVetoPlugin(scope)` is a `pre_tool_call` plugin that refuses any `path`, `file_path`, `filename`, `paths[]` or `apply_patch` destination that resolves, through symlinks and case variants, into one, and an unscoped `git_diff`. `vetoPathCall(scope, name, args)` gives the same verdict for calls that skip the plugin chain; `resolveRealPath`, `isWithin` and `SymlinkLoopError` are exported too                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `./a2a`          | `buildAgentCard` (plain `{name, route, baseUrl}` form), `createA2ATool` — call a remote agent over HTTP as a tool; `timeoutMs` bounds the call and rejects with `A2ATimeoutError` (`A2A call to "<name>" failed: no answer within <ms> ms`), composed with the caller's signal. `createA2AJsonRpcHandler` serves `message/send`; `maxInFlight` caps concurrent turns and answers 503 with `retry-after` (`retryAfterSeconds`, default 5) before the body is read. A slot is held until `respond` settles, even after the handler's own deadline answered. Both options are off by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `./mcp-health`   | MCP server health probing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `./commands`     | Command routing and the shutdown/cleanup contract. `Shutdown.register` returns a disposer (a no-op once `run()` started); `exitAfterDrain(code)` sets the exit code and forces the exit only if the loop has not drained within `capMs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `./doctor`       | Environment diagnostics: `credentialShape(value, { minLength? })` names a malformed credential (`edge_whitespace`, `inner_whitespace`, `quote_or_backslash`, `control_character`, `placeholder`, `too_short`) or returns `ok`, and `describeCredentialDefect` words it without echoing the value; `diagnose`, `renderDiagnosis`, and row builders `checks.credential` (`present` ok, `expired` warn, `absent`/`unreadable` fail; `remedy` option), `checks.capability` (warn when trust withheld the project's entries), `checks.settingsReport` and `checks.leftovers` (each `[]` when there is nothing to say, else one warn row). Compose: `diagnose([checks.credential(state, { remedy }), checks.capability('mcp', wired), ...checks.settingsReport(reports)])`. `writeDiagnosticBundle({ out, files, secrets, mask? })` writes a 0600 `.tar.gz` of masked files and refuses (`DiagnosticBundleError`, reason `secret_survived` or `name_too_long`, nothing written) when a configured secret survives the mask or a name exceeds 100 bytes. `installDiagnosticSink` routes SDK diagnostics from `THEOKIT_DIAGNOSTICS` (`1`/`true`/`stderr`/`yes` for stderr, any other value is a file path); pass `envVar` to read an app-named variable instead, e.g. `{ envVar: 'MYAPP_DIAGNOSTICS' }`. An empty `envVar` throws a `ConfigurationError` |
| `./usage`        | Token and cost accounting: `usageFromRun`, `formatUsd` and `InMemoryUsageStorage`. See the note below the table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `./evals`        | `runAgentEvals` — run cases against an agent and read pass, fail or error per case                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `./handoff`      | `createHandoffConversation`: one agent hands the conversation to another, and the next turn is answered by the receiver                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

`usageFromRun(result, { model })` builds a `UsageRecord` from a run result. `priced` is `false`, and `costUsd` is `0`, when the run has no finite `cost.amountUsd`, so an unpriced model is not read as a free run; `undefined` means priced. `InMemoryUsageStorage.getUsage` leaves unpriced runs out of `totalCostUsd` and counts them in `unpricedRuns`. `formatUsd` prints six significant digits with trailing zeros trimmed.

A terminal command list, with aliases, hidden names and handlers, from `./commands`:

```ts
import { createCommandRegistry, defineCommand } from '@theokit/agents/commands'

const registry = createCommandRegistry<{ exit(): void }>([
  defineCommand({
    name: 'quit',
    description: 'leave',
    aliases: ['exit'],
    arg: 'none',
    run: (_arg, ctx) => ctx.exit(),
  }),
  defineCommand({ name: 'debug', description: 'toggle debug', hidden: true }),
])
registry.palette() // [{ name: 'quit', description: 'leave' }]
await registry.dispatch('/exit', { exit: () => process.exit(0) })
```

A one-shot mode (`myapp "prompt"`) from the same subpath: the answer goes to stdout, progress to stderr, and the exit code says how the turn ended (0 ok, 1 error or empty, 2 cut by a step limit).

```ts
import { readHeadlessPrompt, runHeadlessTurn } from '@theokit/agents/commands'

const prompt = readHeadlessPrompt({
  prompt: process.argv[2],
  stdin: 'append',
  readStdin: () => readFileSync(0, 'utf8'),
})
const result = await runHeadlessTurn(streamAgentTurnInProcess(mod, apiKey, { message: prompt }), {
  io: { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
})
process.exitCode = result.exitCode
```

### Claude Code hook dialect

`parseClaudeHooks(raw, { aliases? })` (from `./hooks`) turns the `hooks` object of a Claude Code `.claude/settings.json` (`{ "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "...", "timeout": 5 }] }] }`) into `{ specs, dropped }`. Each group is flattened to one spec per command, `timeout` seconds become `timeout_ms`, and a `"*"` matcher becomes no matcher. Every spec is validated with `hookSpecSchema`, so a command with control characters is refused. Anything skipped (unknown event, non-command hook, non-object group or entry, invalid spec) gets one line in `dropped`. Events map through `CLAUDE_HOOK_EVENT_ALIASES` (`PreToolUse` to `pre_tool_call`, `PostToolUse` to `transform_tool_result`, `Stop` to `post_assistant_reply`, `SessionStart` to `on_session_start`); pass `aliases` to override, and map a name to `null` for an event this engine does not deliver. Fingerprints are computed on the translated spec, so `HookApprovalStore` works unchanged. `buildHookHandlers({ projectDirEnv: 'CLAUDE_PROJECT_DIR' })` sets that variable to `cwd` in each hook process.

`DEFAULT_PROVIDERS` (used by `resolveAgentCredential`) comes from the SDK provider table, `DEFAULT_PROVIDER_CANDIDATES` in `@theokit/sdk/auth`: env var names and the default order are the SDK's, not a second table in this package. Pass `providers` to narrow or extend it.

`AuthProvider.ensureFresh` throws `RefreshFailure` (exported from `./auth`) when a token refresh fails. It is a `TheokitAgentError` with `code: 'oauth_refresh_failed'`, `isRetryable` equal to `.transient`, and the original error as `cause`, so the SDK's `isTransientError(err)` is `true` for a network reset and `false` for `invalid_grant`.

`loginWithApiKey(key, store, { provider?, overwrite?, env? })` (from `./auth`) trims the key, infers the provider from its prefix when none is given, and writes the credential file, returning `{ provider, path }`. It throws `CredentialError` for an empty key or an unknown prefix without a provider, `ProviderPrefixMismatchError` when the declared provider contradicts the prefix, and `CredentialExistsError` (`code: 'credential_exists'`, names the path) when a file exists and `overwrite` is not set. `logout(store, env?)` removes the file and returns whether there was one; a concurrent removal returns `false`.

`grantGate(store, classify)` (from `./auth`) vetoes a governed call that has no standing grant and never asks anyone. `createApprovalGate({ store, key, waived?, reviewer?, ask?, timeoutMs?, ledger?, recordUngoverned?, persistAlways?, refusal?, onError? })` is the chain in front of it: a session waiver, a saved approval in the same `PermissionStore`, an optional reviewer (`'allow' | 'deny' | 'ask'`), then the person via `ask` (`'once'`, `'always'` which is saved with `store.grant`, or `'deny'`; `{ answer, by }` records who). No `ask` means a refusal (`nobody can approve it`); a timeout is a denial named in the decision's `reason` (it does not call `onError`); a throwing reviewer defers to the person, a throwing asker denies, and each is reported through `onError(error, stage)` and named in `reason`. `decide(ctx)` returns `{ allowed, reason, by }`; `plugin` applies it as a `pre_tool_call` veto. `recordUngoverned: false` writes no receipt for a call `key` leaves ungoverned; `persistAlways: false` treats `'always'` as `'once'` (nothing is saved); `refusal(name, reason)` words the plugin's block message. `createJsonlLedger(dir)` is an append-only `activity.jsonl` (mode 0600) with `read()`; pass it as `ledger` to get one receipt per decision.

`AuthProvider` options: `requestTimeoutMs` aborts each refresh request after that long (default: no timeout), and `onTransientFailure: 'use-stored'` returns the stored credential when a transient failure outlasts the retries (default `'throw'`). An `invalid_grant` always throws.

## Stability tiers: experimental exports

Every export without an `@experimental` tag on its own declaration is stable. `@theokit/agents/testing` is a utility subpath for your own tests (not a test-only seam), and its tier is stable except for the legacy snake_case mock stream listed below. The list below is checked against `public-surface-baseline.json` by `tests/unit/experimental-exports.test.ts`.

<!-- experimental-exports:start -->

- `@theokit/agents/testing`: `MockAgentStreamOptions`, `MockResponse`, `MockStreamEvent`, `createMockAgentStream`
<!-- experimental-exports:end -->

## Testing: the live-suite guard

A live (real-model) suite must not skip green in CI when the provider key is missing. `@theokit/agents/testing` exports `assertProviderKeyWhenRequired`, `requireProviderKeySetup`, `LIVE_KEY_NAMES` and `MissingProviderKeyError`: when `THEOKIT_LIVE_REQUIRED=1` and none of the key variables is set (whitespace-only counts as unset), the run fails with an error that names the variables, never a value. Without the flag it returns, so a local run keeps its skip.

```ts
// tests/live/setup.ts — register it as vitest `globalSetup`
import { requireProviderKeySetup } from '@theokit/agents/testing'

export default requireProviderKeySetup({ requiredFlag: 'MYAPP_LIVE' }) // names and requiredFlag are optional
```

## One bootstrap for every entry

An app with several entries (CLI, ACP server) declares its setup once. Each step runs once, in order,
before anything resolves an SDK path; a failing step throws `BootstrapStepError` and later steps do not run.

```ts
// bootstrap.ts
import {
  defineAppBootstrap,
  projectEnvStep,
  sdkHomeStep,
  secretRefsStep,
} from '@theokit/agents/config'

export const bootstrap = defineAppBootstrap([
  projectEnvStep, // loads .env, refusing the SDK's sovereign keys
  // THEOKIT_HOME and THEOKIT_AUTH_HOME -> <home>/.myapp; or { profile: 'work' } for the SDK profile directory.
  // onConflict: 'env-wins' (default) keeps a set variable; 'refuse' throws SdkHomeConflictError naming it.
  sdkHomeStep({ dirName: '.myapp' }),
  secretRefsStep(), // replaces env values that are secret references (built-in stores)
])

// cli.ts and acp.ts both begin with the same call
import { homedir } from 'node:os'
import { bootstrap } from './bootstrap.js'
await bootstrap.run({ env: process.env, cwd: process.cwd(), home: homedir() })

// any module that resolves SDK paths
import { assertBootstrapped } from '@theokit/agents/config'
assertBootstrapped(bootstrap, 'openTranscriptStore')
```

### `@file` mentions

`resolveFileMentions(text, { cwd, perFileTokens?, totalTokens?, allowHome?, readFile? })` from `@theokit/agents/config` attaches the files a user message mentions with `@path`. `findFileMentions(text)` returns the `{ ref, index }` pairs and uses the same grammar as `expandCommandTemplate`: the `@` must start the text or follow whitespace, and a trailing `.` or `,` is punctuation. Paths resolve under `cwd` with `safePathJoin`, `assertNoSymlinkEscape` and `isForbiddenPath`; `~/` resolves under the home directory only with `allowHome: true`. Each file is capped at `perFileTokens` (default 2000, truncated with a marker) and the set at `totalTokens` (default 20000). The result is `{ message, attached, skipped }`; `skipped` carries `{ ref, reason }` with reason `forbidden`, `outside-root`, `not-found` or `budget` (`unreadable` is in the type but is not produced today), and the text of a skipped mention is left unchanged. Any other error, including a read error other than a missing file, is rethrown.

## Config keys set from the environment

Declare which keys the environment may set, then build a layer for `LayeredConfig` from the variables that are set:

```ts
import { envKnob, envLayerFrom, auditEnvKnobs } from '@theokit/agents/config'

const KNOBS = {
  model: envKnob('MYAPP_MODEL', 'string'),
  memory: envKnob('MYAPP_MEMORY', 'boolean'),
}
const layer = envLayerFrom(process.env, KNOBS) // { memory: true } when MYAPP_MEMORY=on
auditEnvKnobs({
  keys: ['model', 'memory', 'cwd'],
  knobs: KNOBS,
  optOuts: [{ key: 'cwd', reason: 'set per run' }],
})
```

Booleans accept `1/true/yes/on` and `0/false/no/off` (trimmed, case-insensitive); numbers must be finite and non-blank.
Any other value is passed through unchanged, so the schema rejects `MYAPP_MEMORY=maybe` by key name instead of reading it as `false`.
`auditEnvKnobs` reports keys with neither a knob nor an opt-out as unreachable.

## Resolving every config layer

`defineLayeredConfig({ schema, defaults, env?, accumulate?, floors?, profiles? })` from `@theokit/agents/config` returns `{ resolve }`. `resolve({ user, project, projectLocal, env, cli, managed })` folds the layers in this order, later winning: `defaults`, `user`, `project`, `project_local`, `profile`, `env`, `cli`, `managed`. It returns `{ values, profile, provenancePerKey }`.

- Each file layer is checked against the schema (as a partial) and a failure names the layer.
- `profiles: { selectKey, tableKey }`: the last name chosen by user, project, project-local or cli selects a profile; the tables merge per name across the file layers, and an unknown name throws a `ConfigurationError` naming it.
- `floors: { key: { permissiveness, restricted, override } }`: a restricted layer (named from `project`, `project_local`, `profile`, `env`) can only tighten the key; the `override` layer (e.g. `cli`) can loosen it.
- `managed` is applied after the floors, so a managed value for any key is final. For an `accumulate` key it replaces the accumulated list.

### `-c a.b=value` overrides

`parseDottedOverrides(pairs, { coerce? })` from `@theokit/agents/config` turns argv pairs into the
`command-line` layer. Pairs split at the first `=`, keys at `.`; `a.b=1` and `a.c=2` build one nested object.
`__proto__`, `constructor` and `prototype` (in any position), empty segments, a pair without `=`, and pairs that
build incompatible shapes (`a=1` with `a.b=2`, in either order) throw `DottedOverrideError`
(`dotted_override_invalid`, not retryable), naming the pair. Values stay strings unless `coerce(path, raw)` returns
otherwise; `path` is the full dotted key, so `profiles.x.memory` is not coerced like `memory`. The flag name and argv
parsing stay in your app.

```ts
const layer = parseDottedOverrides(['model=x', 'limits.turns=3'], {
  coerce: (path, raw) => (path === 'limits.turns' ? Number(raw) : raw),
})
```

### Trim policy per instruction source

`composeInstructions(base, sources, { maxChars })` from `@theokit/agents/config` walks `sources` from the last
entry. Each source may carry `trim`: `{ kind: 'drop' }` (default, the original behaviour), `keep-head` (cut the end),
`keep-tail` (cut the start) or `{ kind: 'blocks-from-start', separator }` (drop whole blocks from the start, never
cutting inside one). A source with a policy is trimmed as far as it allows before the walk moves on. Sources are
never re-split unless their own policy is `blocks-from-start`. The result's `cuts` lists `{ name, from, to }` for
every source that lost characters (`to` is 0 when dropped); it is empty when everything fit.

## Calling an agent route without `HttpTransport`

An agent route's CSRF gate answers `403 CSRF_FAILED` unless the request carries `X-Theo-Action: 1`.
`@theokit/agents/client` exports the headers, so a script, a test or a plain `fetch` need not spell them:

```ts
import { AGENT_ACTION_HEADERS, agentRequestHeaders } from '@theokit/agents/client'

const res = await fetch('http://localhost:3000/agents/support', {
  method: 'POST',
  headers: AGENT_ACTION_HEADERS,
  body: JSON.stringify({ messages }),
})
// Add your own headers; names merge case-insensitively, the later spelling wins.
const headers = agentRequestHeaders(AGENT_ACTION_HEADERS, { authorization: `Bearer ${token}` })
```

## Mounting a chat route for an agent built elsewhere

`generateAgentRoutes` needs only the route and a `createRun`; `compiledOptions` is optional and never read.

```ts
import { generateAgentRoutes } from '@theokit/agents/bridge'

const routes = generateAgentRoutes({
  walkResult: { route: '/api/agents/support' },
  createRun: (message, sessionId, signal) => runMyAgent(message, sessionId, signal),
})
```

## The shapes worth knowing before you start

**Tool scope is bound once, not per tool.** `bindToolScope({ projectRoot, writeRoot, sandbox })`
returns a binder; every factory it binds inherits the scope. `sandbox` is **required** — a scope
without one would be an unconfined shell, and making it unrepresentable is cheaper than detecting it.

**Human gates come in three layers, and they compose.** You _declare_ which tools need approval on
the builder, the _posture_ decides whether auto-approval is even permissible (it carries the sandbox
posture as evidence, so "auto-approve without confinement" cannot be expressed), and the _resolver_
settles an individual request. `./ask` is the inverse channel — the agent asking you.
A surface reads the open question with `bridge.pending(threadId)` (a read, not a second listener)
and learns of changes with `bridge.onChange(fn)`, which fires after a question is asked, answered,
abandoned or failed and returns its own disposer.

A refused tool result carries `refusal.by`, saying who refused: `human` (a person denied it; `reason` is the approver's text), `timeout` (the approval window expired with no decision), `policy` (the approval posture or the permission gate), `hook` (a hook spec or delegation hook, or an SDK file hook), or `plugin` (a veto from a plugin this framework did not build). `reason` is the bare reason, not the sentence around it. Each framework veto message ends with an unguessable ` [veto:<random hex>]` marker: tool calls dispatch concurrently and the SDK's denial event carries no call id, so the marker is what binds a denial to its own veto (an external denial has no marker and stays `plugin`).

**Sessions are deleted carefully or not at all.** `./session` refuses to collect a transcript that a
live writer holds, floors both `keepLast` and `maxAgeDays`, and plans before it applies. When your
app knows about live sessions this package cannot see, inject them — protection is additive and
never subtractive.

`listSessions(cwd, root?)` in `./session` is the SDK's `listSessions` (the one `./persistence` exports) sorted newest first, minus directories named like a transcript. It is async, as are `protectedTranscriptPaths`, `forkBeforeUserTurn` and `planTranscriptGC`.

**Credentials answer two questions.** Which credential to use, and where it came from. The second
matters more than it looks: without provenance, "why is it calling Anthropic?" has no answer in the
data, and a user cannot tell an explicit choice from a precedence fallback.

## Publishing an A2A agent card

`buildAgentCard` takes a manifest entry, or just a name and route when the agent was not built through the decorators:

```ts
import { buildAgentCard, agentCardPath } from '@theokit/agents/a2a'

const card = buildAgentCard({ name: 'my-agent', route: '/a2a', baseUrl: 'https://app.example.com' })
const path = agentCardPath('my-agent') // /.well-known/my-agent/agent-card.json
```

## Handing a conversation to another agent

`@theokit/agents/handoff` keeps a roster of compiled agents and the name of the one that answers.

```ts
import { createHandoffConversation } from '@theokit/agents/handoff'

const conversation = createHandoffConversation({ agents: [triage, billing], initial: 'triage' })
const first = await conversation.send('I want a refund', { apiKey })
// triage called transfer_to_agent: first.handoff is { from: 'triage', to: 'billing', note }
const second = await conversation.send('It was a gift', { apiKey })
// second.responder is 'billing'
```

The answering agent gets a `transfer_to_agent` tool for its run. The transfer takes effect when that
run returns normally, so a run that throws, or whose `signal` was aborted, leaves the responder where
it was. Each agent keeps its own session, and the receiver reads the transferring agent's note before
the next message. `handoffTo(name, note?)` moves the next turn from your code; it replaces any note
still waiting. Naming the agent that already answers changes nothing, and naming it with a note
throws `already_responder`, since no transfer would deliver the note.

The note opens the receiver's message as `[Handoff from <agent>] <note>`. A model wrote the note
and the user wrote the message, so neither is trusted: `[Handoff from` inside either one is rewritten
to `[quoted: Handoff from`, and so are its lookalikes (fullwidth or accented letters, Cyrillic or
Greek letters that look Latin, zero-width characters, another opening bracket, `_` or `-` for the
space). This narrows the forgery but does not close it: a spelling outside those classes still
arrives as written, so a receiver with tools that matter should not act on a note alone.

The responder and a waiting note are kept in the conversation object's memory. One `conversationId`
belongs to one conversation at a time: a second conversation on the same id cannot run a turn while
the first one is running (`turn_in_progress`). Each agent's session id is
`<conversationId>:<agentName>`, so an agent name that contains `:` is refused with
`invalid_agent_name`; a `conversationId` may contain one.

To resume after a restart, store the last `turn.handoff`. If the receiver has not answered yet,
create the conversation with `initial` set to its `from` and call
`handoffTo(handoff.to, handoff.note)`: the receiver's next message opens with
`[Handoff from <from>] <note>`, as it would have before the restart. Once the receiver has answered,
create the conversation with `initial` set to its `to`. A roster agent, or a per-run `sdkTools`
entry, that brings its own `transfer_to_agent` tool is refused with `reserved_tool_name`.

`@theokit/sdk-handoff` and `createDelegateTool` work differently. They are call-and-return: the
agent you call answers the caller, and the caller keeps the turn.

## Reporting what an agent was built with

`onWired(listener)` on `AgentBuilder` (and `onWired` in `defineAgent`) reports a `CompiledWiring` once per `Agent.create`, after the options are final. Every field is read from those options, not from a second copy of the inputs:

```ts
AgentBuilder.create()
  .model('provider/model')
  .onWired((w) => console.log(w.tools, w.skills.listed, w.skills.readable, w.mcpServers))
```

- `tools`: caller-supplied tool names handed to `Agent.create`. Withheld builtins are listed in `withheldBuiltinTools`; a caller tool sharing a withheld name stays in `tools`. SDK default builtins are not enumerated.
- `skills.listed` / `skills.readable`: the skills the created agent resolved (`agent.skills.list()`, so a withheld project source or an unknown name is absent; SDK 5.17 discovers no user skills and lists an inline skill only when it is also in `skills.enabled`), and, separately, the inline skills a `skill_read` wired by this build serves. A `skill_read` you supply yourself reports none as readable. The listener runs only when the call created the agent, not on a cache hit, a resume, or a concurrent call that shared another's creation.
- `mcpServers`, `subagents`, `settingSources` (`project` / `user`), `withheldBuiltinTools`.
- `hooks`: events registered through `.hooks()`. Hooks inside your own plugins are opaque and not listed.

A listener that throws is reported with `console.warn` and does not fail the build. `recordWiring` is unchanged; feed it from `CompiledWiring` if you want trust suppression.

## Deferring a gated tool call

By default a `@HumanInTheLoop` call pauses the run on `awaitApproval`, so a pending approval lives as long as the process. Set `onDefer` on the HITL wiring to end the run instead: the plugin emits the same approval event, awaits `onDefer(approval)`, then returns the SDK defer veto (`{ defer: true }`) and never calls `awaitApproval`.

```ts
createHitlPlugin({
  gated,
  emit,
  awaitApproval,
  onDefer: async (a) => {
    await store.save(a)
  }, // a: DeferredApproval — approvalId, toolUseId, toolName, input, question, runId, agentId
})
```

Persisting the approval is the host's job. If `onDefer` rejects (or the call has no `toolUseId`), the call is blocked with `approval could not be recorded: <reason>` rather than run unapproved. Resuming the run is not part of this plugin.

## Reading skills with `skill_read`

By default only inline skills (`createSkill(...)`) get a `skill_read` tool; a skill enabled by name or found on disk is listed in the `<skills>` block but its body is not readable. Opt in with `read: 'advertised'`:

```ts
AgentBuilder.create().skills(['deploy'], { read: 'advertised' }) // or defineAgent({ skillsRead: 'advertised' })
```

`skill_read` then serves exactly what the `<skills>` block lists: inline skills, skills enabled by name, and skills discovered through the granted `settingSources` and `claudeCode` roots (project, user, `.claude`, plugin bundles). It runs after the trust gate, so a root the gate withheld is neither read nor named in a not-found answer. The project root wins a name clash. An app-declared `skill_read` tool still takes precedence.

## Delegating to a fresh agent per task

`delegationPortFromAgentFactory(create, { sendOptions })` (from `@theokit/agents/bridge`) returns a
`DelegationPort` that builds an agent with `create` for each task, sends the task, cancels the run when
the delegating signal aborts, and disposes the agent after success, failure or cancellation. A run that
streamed an error or did not end `finished` rejects with a `DelegationError`; guardrail and delegation
errors pass through unchanged.

```ts
import { delegationPortFromAgentFactory } from '@theokit/agents/bridge'

const worker = delegationPortFromAgentFactory(() => createWorkerAgent())
const tool = createDelegateAllTool({ roster: [{ name: 'worker', target: worker }] })
```

## Registering subagents

`AgentBuilder.subagents()` (and `defineAgent({ subagents })`) takes `description` and `prompt` (required), plus optional `tools`, `model` (a `ModelSelection`, or `'inherit'`/absent for the parent's model) and `mcpServers` (names or inline configs, as the SDK takes them). All are passed to the SDK unchanged. `sandbox` and `memory` are not accepted: apply memory with `applySubagentMemory` before registering.

## Withholding SDK builtin tools

`AgentBuilder.withholdBuiltinTools(['shell'])` keeps the named SDK builtin tools (`shell`,
`memory_search`, `memory_get`) out of the model's tool list, on every run path: `createSdkAgentStream`,
`streamAgentTurnInProcess`, the client's `InProcessTransport` and `toAgentFactory`. An unknown name is
refused with a `ConfigurationError`. `toAgentFactory({ withholdBuiltinShell: true })` still works;
when both are set, the union is passed.

## Describing a failed turn

Import from `@theokit/agents/errors`. `classifyTurnFailure(err)` walks `err.cause` (at most eight links) and returns `{ code, rawCode?, transient, message }`; `rawCode` is the code string as given, kept when `code` is coerced to `'unknown'`. A typed code anywhere in the chain wins over text, and `transient` comes only from `isTransientError` and typed provider status fields, never from digits in a message. `describeTurnFailure(failure, { attempts, hints, probe, suffix })` renders `"<message> [<code>]: <hint>"` (an unknown code prints `rawCode`), lets `probe(failure)` return a hint that wins over the per-code hint, appends `suffix` last, and appends `after N attempts` only when `attempts > 1`. `DEFAULT_TURN_FAILURE_HINTS` is neutral; pass `hints` to replace the wording for single codes.

## Hooks the host owns

`buildHookHandlers` wires hooks into one agent loop. Some events belong to the host instead:
`on_session_start` fires once per loop context, so an app that builds a fresh agent per turn would
run a session-start hook on every message. For those, call `runHostHooks(event, specs, options)` from
`@theokit/agents/hooks` at the moment the host starts the session. It applies the same trust and
fingerprint gate as `buildHookHandlers`, ignores specs of other events, and returns one
`HostHookOutcome` per spec (`ran`, `not-approved`, `failed`, `timed-out` or `could-not-start`)
without throwing. `options.env` is required and is the whole environment of the hook; `process.env`
is never inherited. Leave the event unwired in the loop handlers so it is not delivered twice.

## Code mode and plugin hooks

`createCodeMode` (from `@theokit/agents/code-mode`) runs each `api.<name>(input)` call of a script through `onPermissionRequest`. Pass `plugins` to also run their `pre_tool_call` hooks on every script call, after `onPermissionRequest`, so a path veto or approval gate that guards normal calls guards code mode too. A hook that returns `{ block: true, message }` refuses the call with that message; a hook that throws refuses it as well, and the handler never runs. `hookContext: { agentId, runId? }` becomes the `agentId` and `runId` of the hook context. Without `plugins` nothing changes.

## Blocking values copied from untrusted tool output

`createProvenanceGuard(options?)` from `@theokit/agents/bridge` returns an SDK plugin that refuses a
tool call whose argument was copied from untrusted output unless the person also said it. It
remembers the output of untrusted tools (default `web_fetch`, `web_search`, `mcp_*`) on
`post_tool_call`, the output of every other tool and the person's messages as trusted, and on
`pre_tool_call` scans every string in the arguments (nested objects and arrays too) for runs of
`minRun` (default 8) or more characters from `[A-Za-z0-9_\-.:/@#+=%]` that contain a digit or
punctuation. A run found in an untrusted output and in no trusted text blocks the call. Untrusted
tools are never blocked, so a search followed by a fetch still runs. Options: `untrustedSources`
(names or a predicate), `minRun`, `keep` (texts kept per list, default 50) and
`message(toolName, run)`.

State is per instance: the remembered texts live in the plugin, so one instance shared by several
agents or sessions mixes their conversations. Create one per agent or session.

Blind spots: a value shorter than `minRun`, a plain lowercase word, and a value the model reformatted
are not checked; only the last `keep` texts of each kind are remembered, so an older output is
forgotten; the system prompt is not visible to a plugin, and only a tool result's `stdout` is read.

## Hooks for a child agent

`hooksForChild(handlers, { forward?, childLabel? })` from `@theokit/agents/hooks` turns the parent's
`HookHandlers` into an SDK `Plugin` for a child you build yourself (`Agent.create`, a squad member,
a reviewer), so the parent's `pre_tool_call` veto also covers the child. The parent handler gets the
child's real `agentId` and `runId`. By default only `pre_tool_call` is forwarded; pass
`forward: ['pre_tool_call', 'post_tool_call', 'transform_tool_result']` to add the others.
`childLabel` is added to the hook context as `childLabel`. A `pre_tool_call` that throws refuses the
call. It returns `undefined` when no forwarded handler exists, so spread it conditionally:
`plugins: [...(p ? [p] : [])]`.

## Validating direct tool calls

`createToolInvokeRoute` (from `@theokit/agents/bridge`) checks `args` against the tool's own `inputSchema` by default (`validateAgainstInputSchema`, compiled once per tool): a violation answers 400 `invalid_args` with `<path>: <message>`, and a schema that does not compile answers 500 `tool_error`. Pass `validate: myValidator` to replace the default, or `validate: false` to turn validation off.

## Ending a goal loop with a tool

`createGoalSignal()` returns an `update_goal` tool and a judge that read the same state. Add `signal.tool`
to the agent that works on the goal and pass `{ judge: signal.judge }` as the `GoalRunner` deps: the judge
answers `continue` until the agent calls the tool with `complete` (`done`) or `blocked` (`blocked`), with
no extra model call per round. The status is kept until `signal.reset()`, so reset it before the next goal
and use one signal per concurrent goal. `toolName` and `description` rename or reword the tool.

## Isolated workspaces for coding sub-agents

`worktreeProvider(repo, root)` (from `@theokit/agents/bridge`) gives each task its own
`git worktree add -b task/<id> <root>/<id>`. Pass it as `isolation` to `delegate` (or on the
`SubAgentSpec`; the option wins): `delegate` acquires a workspace, runs with `cwd` set to it and
releases it afterwards, on failure too. If the release fails, the task's error is still the one
thrown, with the cleanup failure on its `cleanupError`; when the error cannot carry a property (a
primitive, or a frozen or non-extensible object), an `AggregateError` holding both is thrown instead. A `streamFactory` you supply does not read `cwd`.
Task ids must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` and may not contain `..`; anything else throws
`WorkspaceProviderError`. Used directly, `workspace.release({ keep: true })` leaves the worktree and branch.

Gitignored files are not in a fresh worktree. List them in `.worktreeinclude` at the repo root (one
literal repo-relative file or directory per line, `#` comments allowed; the `include` option renames
the file) and they are copied in. A path that escapes the repository is refused.

### Preparing a fresh checkout

A fresh worktree usually cannot build until its dependencies are installed.
`prepareWorkspace(path, { exec?, setupScripts?, timeoutMs? })` (from `@theokit/agents/bridge`) picks
exactly one recipe and runs it; `detectWorkspaceRecipe(root, { setupScripts? })` only reports it. The
order is:

1. `.devcontainer/devcontainer.json`, then `.devcontainer.json` (JSONC). The host-side lifecycle runs
   `onCreateCommand`, `updateContentCommand`, `postCreateCommand`, `postStartCommand` in that order; an
   object value runs its commands in parallel and the next stage waits.
2. The first existing path in `setupScripts` (relative to the checkout, run with `sh`). The default is
   an empty list: the framework names no product's script.
3. A lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, `bun.lock`), only when
   `node_modules` is absent.

Each command is bounded by `timeoutMs` (default 10 minutes). A failure throws `WorkspaceRecipeError`
with `source` and `stage`, and the original error as `cause`. `worktreeProvider(repo, root, { prepare:
true })` calls `prepareWorkspace` after acquiring; if it fails, the worktree and branch are removed.

## Reading a run's final answer as an object

`createResultCapture(schema)` returns a `submit_result` tool whose input schema is your zod object schema. Add
`cap.tool` to the agent, tell it to finish by calling the tool, then read `cap.result()` after `run.wait()`. A
submission that fails validation goes back to the model as a tool error naming the issue paths, so it can fix
it; the last valid submission wins. `result()` throws `NoResultSubmittedError` when none was valid, and
`submitted()` tells you beforehand. The schema must be an object schema; `name` and `description` rename or
reword the tool.

## Scheduled jobs: file or PostgreSQL

`createScheduler` keeps its jobs in a `JobStore` from `@theokit/agents/tools`. Pick the file store for one host with a disk, or the PostgreSQL store when there are several replicas or no durable disk. The PostgreSQL store takes a ready pool (a `pg` `Pool` has the `query` it needs), so this package adds no driver.

```ts
import { copyJobs, createJobStore, createPostgresJobStore } from '@theokit/agents/tools'

const files = createJobStore('.theoclaw/schedules.json')
const db = await createPostgresJobStore(pool, { table: 'schedule_jobs' }) // /^[a-z_][a-z0-9_]{0,62}$/

await copyJobs(files, db, { force: false }) // throws JobCopyError naming the count if `db` holds jobs
```

Reads come from the jobs loaded when the store opened, and writes run one after another; replicas do not see each other's later changes until they reopen the store. A malformed row raises `ScheduleStoreError` naming the table and job id. `copyJobs` writes through the target's atomic `putMany` (one statement for PostgreSQL, one file rewrite for the file store), so a failure leaves the target unchanged; a custom `JobStore` without `putMany` raises `JobCopyUnsupportedError` before anything is written.

## Running scheduled prompts

`createScheduler` needs a `RunPort`. `agentRunPort(withAgent)` is the stock one: it runs each prompt on the
agent `withAgent` hands it, sends with the scheduler's signal, drains and waits, and returns
`{ ok: false, error }` for a run that ends `error` or `cancelled` or has no result. `withAgent` owns disposal.

```ts
import { agentRunPort, createScheduler, fileTransientJob } from '@theokit/agents/tools'

const scheduler = createScheduler({ store, deliver, run: agentRunPort(withAgent) })
const { job, transient } = fileTransientJob({
  id: 'heartbeat',
  cron: '*/30 * * * *',
  target,
  file: 'HEARTBEAT.md',
})
await scheduler.add(job, transient) // an absent or blank file means no run; other read errors reject
```

## Secret references in configuration

`resolveSecretRefs(env, stores?)` from `@theokit/agents/auth` replaces every value that names a secret
store with the value read from it, once at start. The syntax:

- `secretref:env:NAME` reads another variable of `env`.
- `secretref:file:PATH` reads a file (one trailing newline is dropped).
- `op://vault/item/field` runs `op read --no-newline` (1Password CLI, 15 s timeout).
- `secretref:vault:PATH#FIELD` reads Vault KV v2 at `$VAULT_ADDR/v1/PATH` with `VAULT_TOKEN`.

It returns `{ env, values, refs }`: the new environment, the resolved values (pass them to your output
masks) and a map of variable name to store kind, never a value. References are read from the input
`env` and are not resolved recursively. A failure throws `SecretReferenceError` with `variable` and
`store`; its message never contains the value, and an empty result is refused. Pass your own
`SecretStore` (`kind`, `matches`, `read`) in `stores`, with `...builtinSecretStores` to keep the built-in
ones. The cause of a failure from your own store is never kept, since it could carry the value. A built-in store failure keeps a sanitized replacement as the cause: fixed text plus only `code`, `syscall`, `signal` and `killed` values from a fixed list (for example `ENOENT`). Messages, stderr and any other field of the underlying error are never kept.

## Turning a pushed event stream into an iterable

`streamFromEmitter(start, { signal, isFinal, onError })` from `@theokit/agents/bridge` returns an
`AsyncIterable` for a producer that pushes events to a callback. `return()` aborts the producer's signal
at once, unless a final event (`done` or `error` by default) was already seen. A rejecting producer
yields the `onError` event, unless an error event already went out.

```ts
generateAgentRoutes({
  createRun: (m, s, signal) =>
    streamFromEmitter((emit, sig) => runAgentTurn(/* ... */ emit, sig), { signal }),
})
```

## What changed recently

See [`CHANGELOG.md`](./CHANGELOG.md) — shipped inside this package, so `node_modules` answers the
question without a round trip to the repository.

For "which symbol delivers capability X, and in which version did it land", the CHANGELOG entry that
shipped the symbol is the answer — every entry names the version it landed in.

## Foreign configuration surfaces

Which `.claude/` surfaces this package reads, and which it refuses. A surface is **read, or refused
with a reason** — never accepted and ignored, which is the failure an author cannot tell apart from
configuration that had no effect.

| Surface                                       | State                                                                                                                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                   | **read when the host names it** — see below                                                                                                                                                                                        |
| `settings.json` — `permissions`               | translated into the SDK's `PermissionRule[]`; an entry that cannot be rendered faithfully is reported and excluded                                                                                                                 |
| `settings.json` — `outputStyle`               | read                                                                                                                                                                                                                               |
| `settings.json` — `env`                       | **parsed, not applied** — see below                                                                                                                                                                                                |
| `settings.local.json`                         | read, layered above `settings.json`                                                                                                                                                                                                |
| `skills/`, `agents/`, `commands/`, `plugins/` | read when the dialect is declared                                                                                                                                                                                                  |
| `.mcp.json`                                   | read; a field this runtime does not carry is reported                                                                                                                                                                              |
| `output-styles/*.md`                          | read, selected by `settings.json`                                                                                                                                                                                                  |
| `agent-memory/`                               | **read** — `applySubagentMemory` applies a subagent's `memory:` declaration, and `apps/theocode` calls it (`apps/theocode/packages/agent/src/delegation/role-discovery.ts`). The host still decides: nothing here calls it for you |
| `workflows/*.js`                              | **refused**, and reported. Every other surface is data; a workflow is code, and executing JavaScript found under a caller-supplied directory is a decision that belongs to you                                                     |
| `keybindings.json`                            | **out of scope HERE** — read by the consumer, see below                                                                                                                                                                            |
| `themes/*.json`                               | **out of scope HERE** — read by the consumer, like `keybindings.json`. `apps/theocode` resolves `~/.claude/themes/` in `apps/theocode/packages/tui/src/theme/custom-theme.ts`; this package and `@theokit/tui` read neither        |
| `~/.claude.json` — OAuth state, UI toggles    | **out of scope** — a CLI's own state                                                                                                                                                                                               |
| `~/.claude.json` — personal-scope MCP servers | **read** — `loadPersonalMcpServers`                                                                                                                                                                                                |

**Output styles.** `loadOutputStyle({ name, cwd, homeDir })` matches a style by its file name (without `.md`) or by its frontmatter `name`. The project directory is searched before the home directory; within one directory a file-name match wins over another file's frontmatter name, and two files claiming the same frontmatter name throw `OutputStyleError` naming both paths. A named style with no match throws `OutputStyleError`. `applyOutputStyle(base, style)` (from `@theokit/agents/config`) returns `base` unchanged when there is no style, `` `${base}\n\n${style.content}` `` when `keepCodingInstructions` is true, and `style.content` otherwise.

### Out of scope, and who owns it instead

An absence that reads as an oversight gets re-investigated at full cost by the next person. These
were measured on 2026-09-12 — `keybindings`, `themes/` and `.claude.json` each return **0 files**
across every package source tree, against a control of 31 for `skills` — and each one is a decision
rather than a gap.

**`keybindings.json` and `themes/*.json` are not this package's.** A framework has no keyboard and
no colour: it produces text and tool calls, and the process that renders them owns which key does
what and which escape codes it emits. Reading them here would let this package hold configuration it
cannot act on, which is the accepted-and-ignored failure the table above exists to prevent.

**Where they actually go is the consumer, not `@theokit/tui`.** Re-measured 2026-09-15: the toolkit
carries internal keybindings and reads no file; `theocode` reads `~/.claude/keybindings.json` itself,
in `terminal-io/keybindings.ts`, against a format it measured against the published documentation.
Naming the toolkit as the owner sent a reader to the package that does the least with it — and the
row said `out of scope` without saying out of scope FOR WHOM, which is the half that misleads.

`themes/*.json` is read by the CONSUMER, exactly as `keybindings.json` is: `apps/theocode` resolves
`~/.claude/themes/` in `apps/theocode/packages/tui/src/theme/custom-theme.ts` and selects one through `/theme custom:<slug>`.
This package reads it in 0 files and so does `@theokit/tui` — measured 2026-09-17 against the
installed 0.80.0.

**`~/.claude.json` is two things under one name, and the split is the point.** Its OAuth state and UI
toggles are a CLI's own state — that file is written by a specific program about its own session, and
a library reading another program's login state would be reaching into something it neither owns nor
can refresh. Its **personal-scope MCP servers** are a different matter: an MCP server the operator
registered for themselves is a framework concern, this package already reads project-scope servers
from `.mcp.json`, and the personal scope measured 0 when this was written. **It does not any more:** on the machine this was re-measured on, 2026-09-15, `~/.claude.json` carried 2 personal-scope servers. The gap cost an operator the servers they registered for themselves, which is the difference between a
gap worth declaring and one worth closing — so it was closed. `loadPersonalMcpServers` reads that key
and only that key, and returns empty on a malformed file rather than throwing, because one stray comma
in a shared home file must not break every project on the machine.

**One turn.** `runAgentTurn({ agent, message, runId, emit, signal?, sendOptions?, mapEvent? })` (from `@theokit/agents/bridge`) runs one `agent.send` (the message is a string or `{ text, images }`) on an agent you already hold (it needs only `send`: no `agentId`, no `dispose`), passes each translated event to `emit` (final assistant text already streamed as deltas is not repeated), and resolves, never rejects, with `{ ok: true, usage? }` (`cancelled: true` when the SDK reports the run as cancelled, which is not a failure) or `{ ok: false, code: 'turn_failed' | 'turn_cancelled', reason }`. A streamed `error` fails the turn even when `wait()` reports finished. An aborted `signal` cancels the run and closes the stream without waiting on a hung cancel, and nothing is emitted after that. `completeFromTurn(withAgent)` adapts it to the `complete` port of `createOpenAICompatibleRoutes`; a failed turn throws, so the route answers 502. `withAgent` may yield any agent that has `send` (an `AgentTurnAgent`); a second argument `{ onCancelled?: 'throw' | 'complete', onFailure?(reason) }` sets what an SDK-cancelled run does (default `'throw'`; `'complete'` returns the text so far) and observes a failure's reason before it throws.

**MCP scopes.** `loadMcpScopes({ cwd, home, projectAllowed, onClash?, personalFiles?, onWarn? })` (from `@theokit/agents/bridge`) merges the personal servers (`~/.claude.json` by default) with `<cwd>/.mcp.json`. When `projectAllowed` is false the project's servers are withheld: the file is parsed only to list its names in `projectWithheld`. On a name clash the personal server wins by default, so a repository cannot replace a server the operator configured; pass `onClash: 'project-wins'` for the reference format. Clashes are returned as data in `shadowed`. A malformed file, project or personal, only warns (naming the file) and loads none of its servers; the other scope is kept.

**MCP servers file with a security policy.** `loadMcpServersFile(path, { policy?, onWarn?, env? })` (from `@theokit/agents/bridge`) reads an MCP servers file at a path you name, with the same parser as `loadMcpJson`, but it is strict even with no `policy`, which departs from `loadMcpJson` (that warns and skips): a violation or an unknown key throws `McpFileError` naming the file and the JSON path (never a value) instead of skipping the entry. A missing file is an error. Defaults, each overridable through `policy`: `requireAbsoluteCommandPaths: true` (a command containing `/` must be absolute), `requireAbsoluteCwd: true`, `allowedEnvPolicies: ['inherit-scrubbed', 'core']` (`all` is refused), `maxTimeoutMs: 2147483647` (`requestTimeoutMs` must be a positive integer up to it), `serverName: /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/` (keeps `mcp_<server>_<tool>` intact) and `refuseUnknownKeys: true`. An HTTP `auth` field is always refused because the SDK ignores it. An invalid-JSON error never quotes the file. `mcpSecretValues(servers, minLength = 8)` returns every header and env value of at least `minLength` characters, for an output mask.

Both MCP readers are called by the host, not from inside this package — `loadMcpJson` has no internal
caller either, and a library with no `main()` cannot have one. That is why both rows say **read**: the
criterion is not who calls, it is whether the chain is intact. Nothing drops an MCP server.

`agent-memory/` said **resolvable** under the same criterion, and for a real reason — a `memory:`
declaration was DROPPED by `@theokit/sdk` before any reader could see it, so the applier could be called
and still govern nothing. **That is no longer true**, which is why its row says `read` now. The SDK
carries the declaration, `packages/agents/tests/integration/the-sdk-version-that-parses-memory.test.ts`
pins the half that was dangerous, and `apps/theocode/packages/agent/src/delegation/role-discovery.ts:84-85`
is the join. The sentence above outlived the fix for two days, which is the shape this whole section
exists to catch: the table was corrected and the paragraph explaining it was not.

The registry entry that prompted this counts four decisions across three files, because
`~/.claude.json` is split. That is the count, stated so nobody goes looking for a fourth file.

### `themes/*.json`

Read by the consumer, measured 2026-09-17. After `keybindings.json` turned out to be read by
`apps/theocode` rather than by the package it was attributed to, the obvious next move was to treat
this as the same finding — and it **is** the same finding, which this document denied until the
three packages were named.

The denial is worth keeping, because it shows what an unfalsifiable sentence costs. This section
read _"nobody reads it, in any of the three packages"_ and never said which three. A reader could
not check a set they could not enumerate, so nobody did; naming them took one edit, and the sentence
was false the moment it became checkable — `apps/theocode` resolves `~/.claude/themes/` in
`apps/theocode/packages/tui/src/theme/custom-theme.ts`, with three reads in that one file.

This package has no colour at all — a grep for `color`, `chalk` or `theme` across its source returns
nothing, the one apparent hit being `ansi` inside `stateTransitionHistory`. It produces text and tool
calls; a palette here would be configuration nothing could act on. The toolkit reads no theme file
either, so naming an owner would repeat the mistake the `keybindings.json` row already made.

### Instruction tree: `as-listed` order and `maxCharsPerFile`

`loadInstructionTree({ order: 'as-listed', fileNames: ['SOUL.md', 'IDENTITY.md'] })` returns blocks in
the order of the `fileNames` array within each root. It is only valid with an array; a predicate
throws a `ConfigurationError` naming `order` and `fileNames`.

`budget.maxCharsPerFile` cuts each file at that many characters and appends a `[truncated]` line; the
block carries `truncated: true`. It applies before `maxChars`, so one runaway file cannot push the
others out. A file that fails to read for any reason except `ENOENT` is reported to `onWarn`.

### Upward walk, source priority and operator instructions

`await loadInstructionWalk({ cwd, alternatives: ['THEO.md', 'AGENTS.md'], local: ['AGENTS.local.md'], maxChars })`
walks from `cwd` to the git root with the SDK's `git-root-walk` discovery. Per directory the first
present alternative wins; the `local` chain is independent and loads after the public one. Blocks come
back root first; over `maxChars` the root-most files are cut first (the walk stops at the first block that
does not fit) and `onWarn` says so. Symlink containment is rooted at the shallowest directory holding a
hit, not at the git root. `operator: [paths]` takes `resolveOperatorRoots().instructions[].path`; those files
are read first, each contained to its own directory, so an operator `AGENTS.md` loads for a project with none.

`composeInstructions` sources take `priority`: the lowest is cut first (omitted counts as 0, ties cut the
later-listed source first); the text keeps the listed order and each cut appears in `cuts`.

`resolveOperatorRoots({ user: true })` also returns `instructions`: the operator's `AGENTS.md`
(`kind: 'instructions'`) and `rules/*.md` (`kind: 'rules'`) from `~/.theokit/`, and from `~/.claude/` only
under the `claude-code` grant.

### `CLAUDE.md`

The instruction tree accepts any file list: `input.fileNames`, falling back to a default of
`['THEO.md', 'AGENTS.md', 'THEO.local.md', 'AGENTS.local.md']`. `CLAUDE.md` is not in it, and
`instruction-tree.ts` says so while explaining why `CLAUDE.local.md` is absent too: "a private
companion to a file this does not read would pair with nothing".

A consumer that wants it passes it. Measured 2026-09-15 while auditing this table row by row:
`CLAUDE.md`, `settings.json` → `env` and `agent-memory/` are each resolvable by the host, and each
was listed as `read`. The word describes the mechanism existing; a reader takes it as the behaviour
happening.

### Reading settings under two roots

An app with its own root (`.myapp/`) that also honours `.claude/` uses `settingsCandidates` (per scope,
own root before foreign root; `foreignRoot: false` reads only the own root) and `firstSettingsFile` /
`readSettingsFile`. The first existing file in a scope wins.

```ts
const c = settingsCandidates({ cwd, home, ownRoot: '.myapp' })
const read = firstSettingsFile(c.project, {
  ownKeys: ['model'],
  renames: { outputStyle: 'style' },
  onWarn,
})
```

In an own-root file an unknown key stays in `values`, so your strict schema rejects it by name. In a
foreign-root file it is listed in `unrecognised`. A Claude Code key you do not implement, `$schema` and
`_`-prefixed keys go to `ignored`. `permissions` becomes `permissionRules`, and entries that cannot be
rendered are in `unsupportedPermissions`. `hooks` is returned raw. A file that exists but cannot be
parsed is reported through `onWarn` and yields `undefined`.

### `settings.json` — `env`

`outputStyle` is read AND applied: `loadSettings` returns it and `resolveOutputStyle` hands it to
`loadOutputStyle`, which is the mechanism this package documents.

`env` is parsed and goes no further here. Measured 2026-09-15: the schema accepts it, the only
consumer of a `loadSettings` result in this package reads `outputStyle`, and nothing applies the
parsed values to `process.env`. A host that wants them can read `settings.values.env` and apply
them itself — the same shape as `agent-memory/` above, and stated for the same reason.

Grouping it with `outputStyle` under one `read` claimed for both what is true of one. The rule this
table serves is that a surface is read, or refused with a reason, and never accepted and ignored;
a key that is parsed and dropped is the third state, and it was in this file's own table.

### Inventory of a foreign root

`foreignSurfaceInventory({ cwd, root?, enabled? })` from `@theokit/agents/bridge` returns one entry per
folder (`agents`, `commands`, `skills`, `agent-memory`, `workflows`, `plugins`) with `state`
(`'read'` or `'refused'`), `count` (what that folder's loader would take: `.md` files that open with
frontmatter for `agents`, `.md` files for `commands`, valid `SKILL.md` definitions for `skills`, one per
`<agent>/MEMORY.md`, scripts for `workflows`, bundles with a `skills/` folder for `plugins`),
`unreadable` (entries that exist and could not be read, never thrown) and, when refused, `reason`.
A folder is `read` when the compat surface that feeds it is in `enabled` (default: every surface), so
the inventory follows the gate. `workflows` is always refused. `agent-memory` follows `subagents`;
the host still applies it.

## Why `env` is not applied, rather than not yet applied

This is a refusal with a reason, not a gap waiting for someone.

`env` under `.claude/` sets environment variables, and a variable is not inert. `NODE_OPTIONS`
alone is code execution — `--require ./anything.js` runs a file before the program does — and
`LD_PRELOAD`, `PATH` and `NODE_PATH` each reach the same place by another route. Anything this
package spawns inherits the process environment: hook commands, and the stdio MCP servers whose
`${VAR}` references `expandEnvReferences` already resolves against `process.env`.

`.claude/settings.json` usually arrives with the clone. Applying its `env` would let a repository
choose what runs inside every subprocess of anyone who opens it — the same threat the `hooks` row
above is gated for, arriving by a quieter door. A consumer that wants those values can read
`settings.values.env` and decide for itself, which is where a trust decision of that size belongs.

The honest form of this is what the table now says: parsed, so an author is told the key was seen,
and not applied, so nobody believes it took effect.

### `agent-memory/`

`resolveAgentMemory()` resolves the directory a subagent reads and writes, and returns the first
**200 lines, capped at 25KB**, of its `MEMORY.md` — both caps apply, and truncation is reported
rather than silent.

**The host calls it. Nothing here calls it for you** — and that sentence is the whole contract: this
package exposes the reader, an application wires it.

One does. `apps/theocode` imports `applySubagentMemory` from `@theokit/agents/config` and applies it
to both role sets in `apps/theocode/packages/agent/src/delegation/role-discovery.ts:84`; that reaches `resolveAgentMemory`
through `agent-memory.ts:231`. So the chain runs end to end, and this document says **read** rather
than **resolvable**.

It said the opposite until 2026-09-16, and the reason is worth keeping because it is the failure
mode this table exists to prevent. The measurement behind _"no consumer does yet"_ was true when
taken: the consumer could not call it. Its own source says why — _"`applySubagentMemory` … is NOT in
the published 14.4.0 this project pins, so the one line that wires it does not compile here yet"_.
The integration was written, tested, and left disconnected, waiting on a publish.

What changed is not the code on either side. `apps/theocode` joined this repository, `@theokit/agents`
resolves through the workspace, and the line compiled. **A capability can be published, correct, and
unreachable** — and a document that reports the reachable state as the real one is reporting a
delivery problem as a design decision.

`@theokit/sdk` before 5.9.0 refuses `memory:` in frontmatter entirely, naming the field rather than
the version — `agent-memory.ts` carries that measurement, and
`the-sdk-version-that-parses-memory.test.ts` pins it.

| `memory:` | Root                                        | Who can see it                  |
| --------- | ------------------------------------------- | ------------------------------- |
| `project` | `<cwd>/.claude/agent-memory/<agent>/`       | committed, shared with the team |
| `local`   | `<cwd>/.claude/agent-memory-local/<agent>/` | kept out of version control     |
| `user`    | `~/.claude/agent-memory/<agent>/`           | crosses projects                |

```ts
import { resolveAgentMemory } from '@theokit/agents/config'

const { root, memory, truncated } = resolveAgentMemory({ agent: 'auditor', scope: 'project', cwd })
```

An unrecognised scope is **refused**, not defaulted. The three differ in exactly one way — who can
see the notes — so guessing `project` would publish, on the next commit, something written expecting
privacy. A subagent name that would escape the root is refused for the same reason: it comes from a
file that arrives with the repository.

This is distinct from the session auto-memory at `~/.claude/projects/`: each subagent reads and
writes its own `MEMORY.md`, not the operator's.

## Environment variables

**This list is CLOSED.** A variable that is not in this table is not read by this package — not
"undocumented", not "read somewhere else": not read. That is the whole point of writing it down.
`rules/foreign-config-surfaces.md` settles the same question for `.claude/` file surfaces in one
sentence — _a surface is read, or it is refused with a reason about this product; it is never
accepted and ignored_ — and this is that sentence applied to the environment.

The reason the guarantee is worth more than a list of three: it answers for every variable anyone
could export, including the ones nobody enumerated, so an operator who sets something and sees no
change knows which of the two worlds they are in.

| Variable                  | Security | What it changes                                                                                                                                                                                            | Read at                                                     |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `PATH`                    | no       | Where an advertised skill's required binaries are looked for, when the installed SDK has no `binaryOnPath` of its own. Changing it changes which skills `skill_read` serves.                               | `src/bridge/advertised-skill-read.ts:36`                    |
| `PROGRAMDATA`             | no       | Where the machine-wide operator policy is looked for on Windows. Changing it moves which policy file governs the run.                                                                                      | `src/config/operator-policy.ts:119`                         |
| `THEOKIT_CODEX_CLIENT_ID` | **yes**  | Overrides the OAuth client id used for the Codex device flow. It selects which OAuth client the device authorisation is issued against, so it is a credential-path decision rather than a convenience one. | `src/auth/device-provider.ts:97`, via the constant at `:93` |
| `THEOKIT_DEBUG`           | no       | Turns on debug logging. Log output can contain request shapes, so treat the logs as sensitive even though the switch is not.                                                                               | `src/debug-log.ts:10`                                       |

The `Security` column is a decision per row, not a keyword match on the name. A name containing
`AWS` can be a plain address, and a name matching nothing can disable a control — so each row was
judged rather than classified.

`node scripts/check-env-verdicts.mjs` fails the build in **both** directions: a variable this package
reads and this table omits, and a variable this table lists that nothing reads any more. Without the
second direction the table would keep advertising a variable after a refactor deleted its only read,
which is a worse failure than never having documented it.

## Boundaries this package keeps

- It does **not** call an LLM provider, run a tool-dispatch loop, or own the conversation store.
  Those are the SDK's, and a PR that adds one here is rejected on sight.
- It does **not** depend on the `theokit` web framework. The dependency runs the other way.
- Web Standards over Node APIs inside `src/` — `Request`/`Response`, `fetch`, `crypto.randomUUID`.
  Three `node:crypto` imports remain and each is measured rather than overlooked: `createHash` in
  `packages/agents/src/hooks/hook-fingerprint.ts`, because the Web equivalent is async and this
  function is not, `randomBytes` in `packages/agents/src/hooks/hook-spec.ts`, where
  `getRandomValues` would buy conformance at the cost of a hand-written hex conversion, and
  `timingSafeEqual` in `packages/agents/src/control/device-pairing.ts`, which compares a pairing
  credential in constant time and has no Web equivalent. Another
  was removed on 2026-09-17: `randomUUID` had no such defence — the global is the API this line
  names, and three other files in the package were already using it.
  File reads keep `node:fs`: there is no Web Standard to prefer.
  Node APIs live in adapters.

## Who decides policy

**An operator who did not write the code can impose policy on it.** That is a decision, recorded
here because it is the one a team evaluating this framework for deployment needs before anything
else.

It was not always true. Hooks, MCP servers, permissions and skill execution were each a value the
_programmer_ passed at build time — a constructor argument, decided in code, by whoever wrote the
agent. That is a defensible design for a framework and an indefensible one for anything an
organisation deploys: it means the person responsible for what an agent may do on a machine has no
way to say so.

Policy is read from disk, and the layers have a fixed precedence:

| Layer                                             | Who writes it                   | Wins against     |
| ------------------------------------------------- | ------------------------------- | ---------------- |
| `managed-settings.json`                           | the operator / the organisation | everything below |
| `.claude/settings.json`, `.theokit/settings.json` | the project                     | the code         |
| `defineAgent({ … })`                              | the programmer                  | nothing          |

A programmer can still decide everything, and in a single-author project nothing above them exists.
What changed is that they are no longer the _only_ one who can.

Two consequences worth stating, because they are the cost:

- A value declared in code can be **overridden by a file the programmer does not control**. That is
  the point, and it means a build-time guarantee is not one.
- An operator restriction is refused loudly rather than silently narrowed. A policy that quietly
  did less than it said would be worse than none — the failure this repository keeps finding under
  other names.

## Licence

See `LICENSE`.

## Named sessions with interrupt and steer

`createSessionStore` (from `@theokit/agents/control`) keeps one agent per client-chosen session id
(`/^[A-Za-z0-9_-]{1,64}$/`, else `bad_session`), runs one turn at a time on each through `runAgentTurn`,
and keeps at most `max` (default 16). Admission is synchronous, so two new sessions cannot both take
the last slot; a full store disposes its least recently used idle agent, or answers `busy` when every
session is running.

```ts
import { createSessionStore } from '@theokit/agents/control'

const store = createSessionStore({ build: () => createMyAgent(), max: 16 })
const outcome = await store.run('chat-1', 'hello', (event) => send(event), socket) // never rejects
store.steer('chat-1', 'also mention X') // 'steered' | 'no_turn'
store.interrupt('chat-1') // 'cancelled' | 'no_turn'
store.cancelOwnedBy(socket) // the socket closed
await store.close()
```

An interrupt cancels the turn and the next turn waits up to `drainMs` (5000) for it to unwind; the next
message is prefixed with `redirectNote` so the model does not resume the withdrawn request. Disposal
failures outside a turn go to `report`; secret masking is the caller's (`sendOptions` or `emit`).
After `close()`, `run` answers `turn_failed`.

## Device pairing

`createDevicePairing({ dir })` (from `@theokit/agents/control`) lets a phone or second machine reach a control surface. The owner calls `issueCode()` (valid `codeTtlMs`, default 10 minutes, and for one request). The device redeems it with a name (max 64 characters) and a credential it chose: `request(code, name, credential)` refuses `bad_credential` (shorter than `minCredentialLength`, default 32, or fewer than 10 distinct characters), `bad_name`, `unknown_or_expired` and `too_many_pending` (`maxPending`, default 20). The owner lists `pending()`, then `approve(id)` or `deny(id)`. Approved devices are stored in `<dir>/devices.json` (mode 0600) as SHA-256 digests only; `accepts(authorization)` compares a `Bearer` header in constant time.

`redeemPairing({ url, code, name })` is the device side: it generates a credential, POSTs `{ code, name, token }` to `/control/pair` on the origin of `url` (`http(s)://` or `ws(s)://`) and returns `{ url, credential }`, where `url` is the `ws(s)://…/control` address. A refused or expired code throws `PairingRefusedError` (`status`, `reason`) and returns no credential. The device is only pending then: `createControlClient({ url, authorization: \`Bearer ${credential}\` })`connects after the owner calls`approve`.

```ts
import { createDevicePairing, pairRoute } from '@theokit/agents/control'

const pairing = createDevicePairing({ dir: stateDir })
const handlePair = pairRoute(pairing) // POST { code, name, token } -> 202 { id } | 400 | 401 | 413 | 429
pairing.onRevoke((id) => closeSocketsOf(id)) // e.g. close with code 1008
await pairing.revoke('my-phone') // removes every approved device with that name (names are not unique)
```

`revoke(name)` calls each `onRevoke` listener with the id of every removed device, after the store is written. Device names are not unique: two devices approved under the same name are revoked together. Approving a request whose credential matches an already approved device replaces that device silently, and its id is passed to `onRevoke` so its sockets close. The route reads `{ code, name, token }` (`credential` is accepted as an alias for `token`).

## Sessions

`@theokit/agents/session` forks a session before a user turn with `forkBeforeUserTurn(srcId, newId, nth, { cwd })`.
`listUserTurns(sessionId, { cwd })` lists the turns it can cut before as `{ nth, text }`. `nth` is 1-based and is
the number `forkBeforeUserTurn` takes, so a backtrack UI can show the list and fork at the chosen entry.

`streamTurnForkingIfBusy(sessionId, open, { onFork?, forkId?, isBusy? })` is for one-shot surfaces (an `exec`
command, a cron job, a CI step) that resume a session another process may be writing. `open(id)` returns the
turn's chunk stream. If the session is busy, the turn re-runs once under `${id}-fork-<8 hex>` and `onFork(from, to)`
is called. Busy is detected up front with `isBusy` (default: `sessionHasWriter` on the transcript under
`transcriptRoot()` and `process.cwd()`; pass `isBusy` for another cwd) or from the `data-error-code`
`session_busy` part and the `error` chunk after it. Both are swallowed, and the structural chunks held before the
first content chunk are dropped, so the contended attempt emits nothing. The fork starts a fresh session; no history
is copied. A second contention throws `ForkedSessionBusyError` (`code: 'session_busy_after_fork'`). The returned
`sessionId` promise resolves to the id that ran once `chunks` has been consumed. Other errors pass through.

`deleteSession(id, { cwd, removeFromRegistry })` reports `registryOutcome: 'unconfirmed'` with the SDK's
`Agent.delete`, because that returns `Promise<void>`. Pass `isListedInRegistry` to have it measure instead.
It is called before and after the removal:

```ts
await deleteSession(id, {
  cwd,
  removeFromRegistry: (sessionId) => Agent.delete(sessionId),
  isListedInRegistry: async (sessionId) =>
    (await Agent.list({ runtime: 'local', cwd })).items.some((a) => a.agentId === sessionId),
})
```

Listed after the removal is `still-present`; not listed before is `nothing-to-remove`; listed before and not
after is `removed`. A verifier that throws or exceeds `registryTimeoutMs` gives `unconfirmed` with the error in
`registryError`, and the transcript step still runs. Without a verifier nothing changes.

### Planning a GC across every project

`planProjectsGC({ projectsRoot, keepLast, maxAgeDays })` is the read-only plan for reclaiming disk across every
project under `projectsRoot(root)`, where `planTranscriptGC` covers one `cwd`. It never deletes anything; applying a
plan is a separate step. Each candidate is `{ project, kind, target, sessionId?, ageDays }`, with `kind` one of
`transcript`, `writer-lock`, `lock-directory`, `temp` or `registry`.

- A project whose liveness is `undetermined` is kept whole.
- The newest `keepLast` transcripts survive, and in a live project so do the newest one, the session the pointer
  names, every non-archived registry entry, anything `protectedIds(cwd)` names and anything with a live writer.
- Locks whose transcript is gone, atomic-write temp files and registry entries whose transcript is gone are planned
  once they are older than `maxAgeDays`. Temp files are recognised by `classifySessionArtifact`, so an editor's
  `notes.txt.tmp` or `.foo.swp` is never a candidate. A registry entry with no `lastModified` is kept.
- An entry whose `mtime` cannot be read is never collected. A failed pointer or registry read skips that project and
  adds to `errors`.
- Several cwds can share one project directory (the encoding is lossy). Every cwd the transcripts record is consulted,
  and `candidateCwds()` adds known workspaces that encode to the project, so a colliding cwd with no transcript of
  its own is protected too. Planning a project needs `candidateCwds` listing every cwd of the app that could share the directory AND `candidateCwdsComplete: true`, the caller's declaration that the list is complete (a colliding cwd known only to its own registry cannot be discovered from disk); without both a project (live or dead: a dead verdict can rest on headers alone) is kept whole and the reason is in `kept`. Any project, live or dead,
  holding a transcript whose header cannot be read or names no cwd of the project is kept whole.
- `keepLast` or `maxAgeDays` below 1 throws `GCFloorError`.

The plan also reports `touchedProjects`, `liveCwds` and `countByKind`. `listRegistry` defaults to `Agent.list`.

### Applying a cross-project plan

`runProjectsGC(plan, { apply, owner, removeFromRegistry?, registryTimeoutMs?, protectedIds? })` applies a plan. Without
`apply: true` it is a dry run: nothing is removed and `removed` lists every candidate. When applying, it re-reads each
live project's pointer, `protectedIds(cwd)` and the writer lease before EACH removal, and puts a candidate in `refused`
(with the reason) when it changed since the plan. A registered transcript goes through `removeFromRegistry` (default
`Agent.delete`, bounded by `registryTimeoutMs`) before its file is unlinked; a lock directory goes through `rmdir`. An
already-missing target is not an error, other failures land in `errors` per target, and a project directory left empty
is removed.

Applying requires the root to be owned by `owner.app`. `claimCollectorRoot(projectsRoot, { app })` writes the marker
`.theokit-collector.json` (`{ app, version }`) next to `projects/`; it never replaces another app's marker
(`CollectorRootNotOwnedError`) and throws `CollectorRootError` when the marker cannot be written.
`collectorRootOwner(projectsRoot)` reads it (`undefined` when absent or malformed). Whether to claim a root is the
app's call: claim the default root, and a custom one only if it holds no projects yet. `runProjectsGC` throws
`CollectorRootNotOwnedError` (code `collector_root_not_owned`) when the marker is missing or names another app.

### Scheduling the sweep

A long-running process can sweep on a timer inside itself: `startInProcessSweeper(intervalMs, run)` calls `run` at
once and then every `intervalMs`, skips a tick while a run is still going, unrefs its timer, and returns
`{ stop() }`; `stop()` resolves after a run in flight settles. A throw from `run` is swallowed, so report inside it.
The rest of this section is the detached-child scheduler.

`scheduleSessionSweep({ enabled, stampFile, command, onReport, intervalHours?, timeoutMs? })` runs the cross-project GC
in a detached child, at most once per `intervalHours` (default 24). It reads `stampFile` (an unparseable or missing
stamp counts as a first run), writes it BEFORE spawning, and never blocks or throws: a failure goes to `onReport`.
The first run is dry (`command({ apply: false })`), later ones apply. The child gets `timeoutMs` (default 600000) and
`SIGTERM`; when it closes, its last stdout line is reported. The command is the app's: `sweepDecision` is the pure
interval check.

```ts
import { dirname, join } from 'node:path'
import { projectsRoot, scheduleSessionSweep } from '@theokit/agents/session'

scheduleSessionSweep({
  enabled: true,
  stampFile: join(dirname(projectsRoot()), '.last-session-gc'),
  command: ({ apply }) => ({
    command: process.execPath,
    args: [myScript, 'sessions-gc', ...(apply ? ['--apply'] : [])],
  }),
  onReport: (line) => console.error(line),
})
```

```ts
// the child (myScript sessions-gc): plan, then run
import {
  claimCollectorRoot,
  planProjectsGC,
  projectsRoot,
  runProjectsGC,
} from '@theokit/agents/session'

const root = projectsRoot()
const apply = process.argv.includes('--apply')
if (apply) claimCollectorRoot(root, { app: 'my-app' }) // only if the app owns this root
const plan = await planProjectsGC({
  projectsRoot: root,
  keepLast: 20,
  maxAgeDays: 30,
  candidateCwds: () => knownWorkspaces(),
  candidateCwdsComplete: true, // only if the list is truly complete
})
const result = await runProjectsGC(plan, { apply, owner: { app: 'my-app' } })
console.log(
  `${result.dryRun ? 'would remove' : 'removed'} ${result.removed.length} of ${plan.candidates.length}`,
)
```

## Refused tool calls

When the SDK reports `permission_denied` for a tool call, the bridge sets `ToolResultEvent.refusal` (`ToolRefusal` from `@theokit/presenter`: `by`, `reason?`) on that call's result. `source: 'file_hook'` gives `by: 'hook'`; `'plugin'` and `'fork_whitelist'` give `by: 'plugin'`; `reason` is the SDK message. An exit code of 126 alone is not a refusal. A veto the framework made ends its model-facing message with a ` [veto:<random hex>]` marker (see the refusal paragraph above); a veto from an external plugin is passed through as written.

## Serving sessions over a WebSocket

`attachControlSocket(server, { authorize, sessions, path?, maxPayloadBytes?, log? })` (from
`@theokit/agents/control`) attaches to an existing `node:http` server and serves a session store to a
remote surface. It needs the optional peer `ws`, loaded when you call it.

```ts
import { attachControlSocket, createSessionStore } from '@theokit/agents/control'

const sessions = createSessionStore({ build: () => createMyAgent() })
const control = attachControlSocket(server, {
  authorize: (header) => header === `Bearer ${token}`, // or { revoked: (cb) => ... }
  sessions,
})
await control.close() // removes the upgrade listener, terminates sockets
```

An upgrade is refused before any agent exists: `404` for another path (default `/control`), `401` when
`authorize(authorization)` returns `false` (or throws). Returning `{ revoked(cb) }` closes the socket
(1008) when `cb` is called. A frame above `maxPayloadBytes` (default 65 536) closes the socket with 1009.

Frames are JSON text. Client to server:

| Frame                                 | Meaning                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ type: 'chat', message, session? }` | One turn. One chat at a time per socket (`error` `busy` otherwise). Without `session`, a private session per socket is used and responses omit `session`. |
| `{ type: 'interrupt', session }`      | Cancel the session's running turn.                                                                                                                        |
| `{ type: 'steer', session, message }` | Inject a message into the running turn.                                                                                                                   |

Server to client: `event` (`{ event, session? }`), `done` (`{ session?, usage? }`), `interrupted`,
`interrupt_ok`, `steer_ok`, `no_turn` (each with `session`), and `error` (`{ code, session? }`). `code` is
`bad_frame` for an unparsable or unknown frame (the socket stays open), or the store's refusal
(`busy`, `bad_session`, `turn_failed`, `turn_cancelled`). `interrupted` for a sessionless chat carries the
private session id. When a socket closes, the turns it started are cancelled.

### Client

`createControlClient({ url, authorization })` (from `@theokit/agents/control`, also needs `ws`) opens a
socket with the `authorization` header value you pass (include any `Bearer ` prefix). One chat runs at a time per client.

```ts
import { createControlClient } from '@theokit/agents/control'

const client = await createControlClient({
  url: 'ws://127.0.0.1:8080/control',
  authorization: `Bearer ${token}`,
})
for await (const frame of client.chat('hello', 'main')) {
  if (frame.type === 'event') render(frame.event) // ends after done, interrupted or error
}
client.interrupt('main') // or client.steer('main', 'use the other file')
await client.close()
```

A URL that is not `ws://` or `wss://`, a refused upgrade (`HTTP <status>`) and a closed connection reject
with `ControlConnectionError`; its message never contains the credential. A 1009 close reports the
frame limit.

## Exposing local tools to a hosted MCP client

Run `createMcpRelayServer({ instanceToken, grants })` where the client can reach it, and
`startMcpRelayConnector({ url, token, tools, dispatch })` beside the agent. `grants` is a
`createGrantStore(file)` from `@theokit/http/guards`; a grant's scopes are tool names, and the
connector passes `dispatch` only the tools the grant allows, so `tools/list` and `tools/call` both
see the filtered set.
